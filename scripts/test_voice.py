"""Test the deployed voice agent end to end with typed customer turns. No microphone needed.

Follows the Learn "Run a session" steps and the azure-ai-projects sample
sample_voice_agent_live_managed_agent_async.py:
- wait for session.started and check that it delegates to the pinned specialist version;
- keep sending real-time silence, because GPT-Live only speaks while input audio arrives;
- send each customer turn as a typed message, which goes to the specialist through a managed delegation;
- treat 3 quiet seconds as the end of a spoken reply, because there is no "speech done" event;
- close with session.close and wait for session.closed.

Usage: uv run scripts/test_voice.py [--scenario NAME]
"""

import argparse
import asyncio
import base64
import sys
import time
from array import array
from collections.abc import Mapping
from contextlib import suppress
from dataclasses import dataclass, field

from azure.ai.projects.aio import AIProjectClient
from azure.core.exceptions import HttpResponseError

from common import (
    AUDIO_SAMPLE_RATE,
    SPECIALIST_NAME,
    VOICE_AGENT_NAME,
    ConfigError,
    azd_credential_async,
    load_azd_env,
    require_env,
)
from scenarios import SCENARIOS

CHUNK_SECONDS = 0.05
SILENCE_CHUNK = bytes(int(AUDIO_SAMPLE_RATE * CHUNK_SECONDS) * 2)  # 50 ms of PCM16 mono silence.
QUIET_SECONDS_AFTER_REPLY = 3.0
AUDIBLE_SAMPLE_LEVEL = 256  # The SDK sample's threshold for ignoring near-silent output audio.
REPLY_TIMEOUT_SECONDS = 150.0  # A delegation must finish within 120 seconds; then the answer is spoken.
SESSION_EVENT_TIMEOUT_SECONDS = 30.0
CLOSE_TIMEOUT_SECONDS = 10.0
FAILED_BACKEND_EVENTS = {"error", "response.failed", "response.incomplete", "response.cancelled"}
FAILED_BACKEND_STATUSES = {"failed", "incomplete", "cancelled"}


class VoiceTestError(Exception):
    """The live session did not behave as expected."""


def raise_on_error(event: Mapping) -> None:
    """Raise on session errors and failed specialist responses, like check_event in the SDK sample."""
    if event.get("type") == "error":
        error = event.get("error") or {}
        raise VoiceTestError(f"Live session error {error.get('code')}: {error.get('message')}")
    if event.get("type") == "response.event":
        backend_event = event.get("event") or {}
        status = (backend_event.get("response") or {}).get("status")
        if backend_event.get("type") in FAILED_BACKEND_EVENTS or status in FAILED_BACKEND_STATUSES:
            raise VoiceTestError(f"Specialist response {backend_event.get('type')} (status: {status})")


def is_audible(pcm: bytes) -> bool:
    samples = array("h", pcm[: len(pcm) - len(pcm) % 2])
    return any(abs(sample) > AUDIBLE_SAMPLE_LEVEL for sample in samples)


@dataclass
class ReplyTracker:
    """Follows one spoken reply (delegations, transcript and audio) until the agent goes quiet."""

    started_at: float
    last_activity: float
    transcript_parts: list[str] = field(default_factory=lambda: [""])
    open_delegations: set[str] = field(default_factory=set)
    spoke_after_last_delegation: bool = True
    audio_bytes: int = 0
    conversation_ended: bool = False
    closed_event: Mapping | None = None

    @classmethod
    def start_now(cls) -> "ReplyTracker":
        now = time.monotonic()
        return cls(started_at=now, last_activity=now)

    def log(self, message: str) -> None:
        print(f"  +{time.monotonic() - self.started_at:4.1f}s  {message}")

    def observe(self, event: Mapping, now: float) -> None:
        # SDK events are mappings, and session.delegation.done is not modelled yet,
        # so dispatch on the "type" field like the official samples do.
        raise_on_error(event)
        event_type = event.get("type")
        if event_type == "session.delegation.created":
            self.on_delegation_created(event.get("delegation") or {}, now)
        elif event_type == "session.delegation.done":
            self.on_delegation_done(event, now)
        elif event_type == "session.output_transcript.delta":
            self.on_transcript(event.get("delta") or "", now)
        elif event_type == "session.output_audio.delta":
            self.on_audio(base64.b64decode(event.get("delta") or ""), now)
        elif event_type == "session.commentary.appended":
            self.log("specialist answer handed to GPT-Live")
        elif event_type == "session.end_conversation.completed":
            self.conversation_ended = True
            self.log("agent ended the conversation")
        elif event_type == "session.end_conversation.cancelled":
            self.log("agent's ending was cancelled; the session stays open")
        elif event_type == "session.closed":
            self.closed_event = event

    def on_delegation_created(self, delegation: Mapping, now: float) -> None:
        self.open_delegations.add(delegation.get("id"))
        self.spoke_after_last_delegation = False
        self.transcript_parts.append("")
        self.last_activity = now
        self.log(f"delegated to {SPECIALIST_NAME}")

    def on_delegation_done(self, event: Mapping, now: float) -> None:
        status, error_code = event.get("status"), event.get("error_code")
        self.open_delegations.discard(event.get("delegation_id"))
        self.last_activity = now
        self.log(f"delegation {status}" + (f" ({error_code})" if error_code else ""))
        if status != "completed":
            raise VoiceTestError(f"Delegation {status}: {error_code or 'no error code'}")

    def on_transcript(self, delta: str, now: float) -> None:
        if not self.transcript_parts[-1]:
            self.log("agent speaking")
        self.transcript_parts[-1] += delta
        if delta.strip():
            self.spoke_after_last_delegation = True
            self.last_activity = now

    def on_audio(self, pcm: bytes, now: float) -> None:
        self.audio_bytes += len(pcm)
        if is_audible(pcm):
            self.last_activity = now

    def is_finished(self, now: float) -> bool:
        if self.conversation_ended or self.closed_event is not None:
            return True
        return (
            not self.open_delegations
            and self.spoke_after_last_delegation
            and any(part.strip() for part in self.transcript_parts)
            and now - self.last_activity >= QUIET_SECONDS_AFTER_REPLY
        )

    def print_transcript(self) -> None:
        for part in filter(str.strip, self.transcript_parts):
            print(f"Agent: {part.strip()}")
        print(f"  ({self.audio_bytes / (2 * AUDIO_SAMPLE_RATE):.1f} s of audio)")


async def wait_for_event(connection, event_type: str, timeout: float) -> Mapping:
    """Read events until one of the given type arrives, like wait_for_event_async in the SDK sample."""
    try:
        async with asyncio.timeout(timeout):
            while True:
                event = await connection.recv()
                raise_on_error(event)
                if event.get("type") == event_type:
                    return event
                if event.get("type") == "session.closed":
                    raise VoiceTestError(f"Session closed while waiting for {event_type}: {event.get('reason')}")
    except TimeoutError as error:
        raise VoiceTestError(f"Timed out waiting for {event_type}.") from error


async def stream_until_reply_finished(connection, reply: ReplyTracker) -> None:
    """Send real-time silence and read events until the agent finishes speaking."""
    deadline = time.monotonic() + REPLY_TIMEOUT_SECONDS
    next_send = time.monotonic()
    while not reply.is_finished(time.monotonic()):
        if time.monotonic() > deadline:
            raise VoiceTestError(f"No finished reply within {REPLY_TIMEOUT_SECONDS:.0f} seconds.")
        if time.monotonic() >= next_send:
            await connection.session.input_audio.append(audio=SILENCE_CHUNK)
            next_send = time.monotonic() + CHUNK_SECONDS
        try:
            event = await asyncio.wait_for(connection.recv(), timeout=max(0.001, next_send - time.monotonic()))
        except TimeoutError:
            continue
        reply.observe(event, time.monotonic())


async def next_spoken_reply(connection) -> ReplyTracker:
    reply = ReplyTracker.start_now()
    await stream_until_reply_finished(connection, reply)
    reply.print_transcript()
    return reply


async def send_customer_turn(connection, text: str) -> None:
    """A typed message goes to the session's backend (the specialist), not to the voice model."""
    await connection.response.item.create(
        item={"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}
    )
    await connection.response.create()


def check_pinned_delegation(started_event: Mapping, specialist_version: str) -> None:
    delegation = (started_event.get("session") or {}).get("delegation") or {}
    actual = (delegation.get("type"), delegation.get("agent_name"), delegation.get("agent_version"))
    expected = ("foundry_managed_agent", SPECIALIST_NAME, specialist_version)
    if actual != expected:
        raise VoiceTestError(f"Session delegates to {actual}, expected {expected}.")
    print(f"Session started; delegation pinned to {SPECIALIST_NAME}:{specialist_version}.")


async def run_conversation(connection, specialist_version: str, customer_turns: list[str]) -> ReplyTracker:
    """Hear the greeting, then send each customer turn and wait for the spoken reply."""
    started = await wait_for_event(connection, "session.started", SESSION_EVENT_TIMEOUT_SECONDS)
    check_pinned_delegation(started, specialist_version)
    print("\n(greeting)")
    reply = await next_spoken_reply(connection)
    for turn in customer_turns:
        if reply.conversation_ended or reply.closed_event is not None:
            raise VoiceTestError("The session ended before all customer turns were sent.")
        print(f"\nCustomer: {turn}")
        await send_customer_turn(connection, turn)
        reply = await next_spoken_reply(connection)
    return reply


async def finish_session(connection, last_reply: ReplyTracker) -> None:
    """Close the session unless the agent already ended it, then report why it closed."""
    closed = last_reply.closed_event
    if closed is None and not last_reply.conversation_ended:
        await connection.session.close()
    if closed is None:
        # Learn doesn't say whether session.closed follows end_conversation, so don't require it.
        try:
            closed = await wait_for_event(connection, "session.closed", CLOSE_TIMEOUT_SECONDS)
        except VoiceTestError:
            if not last_reply.conversation_ended:
                raise
            print("\nSession ended by the agent.")
            return
    usage = closed.get("usage") or {}
    print(f"\nSession closed: {closed.get('reason')}; session seconds: {usage.get('seconds')}")


async def run_scenario(project: AIProjectClient, voice_version: str, specialist_version: str, turns: list[str]):
    async with project.beta.voice_agents.live.connect(
        agent_name=VOICE_AGENT_NAME, agent_version=voice_version
    ) as connection:
        try:
            last_reply = await run_conversation(connection, specialist_version, turns)
        except BaseException:
            # End the session before the WebSocket closes, without hiding the original error.
            with suppress(Exception):
                await asyncio.wait_for(connection.session.close(), timeout=CLOSE_TIMEOUT_SECONDS)
            raise
        await finish_session(connection, last_reply)


async def latest_voice_agent(project: AIProjectClient) -> tuple[str, str]:
    """Return the latest voice-agent version and the specialist version it is pinned to."""
    voice_agent = (await project.agents.get(VOICE_AGENT_NAME)).versions.latest
    return str(voice_agent.version), str(voice_agent.definition["delegation"]["agent_version"])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), default="high-bill")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    # Transcripts can hold characters the Windows console code page can't encode.
    sys.stdout.reconfigure(encoding="utf-8")
    load_azd_env()
    async with azd_credential_async() as credential, AIProjectClient(
        endpoint=require_env("FOUNDRY_PROJECT_ENDPOINT"), credential=credential, allow_preview=True
    ) as project:
        voice_version, specialist_version = await latest_voice_agent(project)
        print(f"Testing {VOICE_AGENT_NAME}:{voice_version} with scenario '{args.scenario}'")
        await run_scenario(project, voice_version, specialist_version, SCENARIOS[args.scenario])


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (ConfigError, VoiceTestError) as error:
        sys.exit(f"Error: {error}")
    except HttpResponseError as error:
        sys.exit(f"Foundry request failed (HTTP {error.status_code}): {error.message}")
