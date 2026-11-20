"""Test the billing specialist on its own, before it is reached through the voice agent.

Learn ("Use Foundry-managed agent delegation") recommends testing the prompt agent on its own,
because Agent Service drops any answer that breaks the tagged-text format. This script sends
each scenario to the specialist version the voice agent is pinned to, prints the answers for
review, and checks every answer against the documented format rules.

Usage: uv run scripts/test_specialist.py [--scenario NAME]
Exits with code 1 if any answer breaks the format.
"""

import argparse
import sys
import time
from dataclasses import dataclass

from azure.ai.projects import AIProjectClient
from azure.core.exceptions import HttpResponseError
from openai import APIError

from common import (
    SPECIALIST_NAME,
    ConfigError,
    azd_credential,
    load_azd_env,
    pinned_specialist_version,
    require_env,
)
from scenarios import SCENARIOS

SECTION_MARKERS = ("[commentary]", "[thinking]")
MAX_SECTIONS = 16
MAX_SECTION_BYTES = 500


@dataclass
class Section:
    kind: str
    text: str


def utf8_size(text: str) -> int:
    return len(text.encode("utf-8"))


def marker_at_line_start(line: str) -> str | None:
    return next((marker for marker in SECTION_MARKERS if line.startswith(marker)), None)


def split_sections(message: str) -> list[Section]:
    """Split a tagged-text message into sections; lines without a marker continue the current section."""
    sections: list[Section] = []
    for line in message.strip().splitlines():
        marker = marker_at_line_start(line)
        if marker:
            sections.append(Section(kind=marker.strip("[]"), text=line[len(marker) :].strip()))
        elif sections:
            sections[-1].text = f"{sections[-1].text}\n{line}".strip()
    return sections


def line_problems(message: str) -> list[str]:
    """Check the line-level rules: start with a marker, no code fences, no other lines starting with '['."""
    problems = []
    if not marker_at_line_start(message.lstrip()):
        problems.append("text before the first section marker")
    for number, line in enumerate(message.splitlines(), start=1):
        marker = marker_at_line_start(line)
        rest_of_line = line[len(marker) :] if marker else line
        if line.lstrip().startswith("```"):
            problems.append(f"line {number}: code fence")
        elif line.startswith("[") and not marker:
            problems.append(f"line {number}: starts with '[' but is not a section marker")
        if any(other in rest_of_line for other in SECTION_MARKERS):
            problems.append(f"line {number}: section marker in the middle of a line")
    return problems


def section_problems(sections: list[Section]) -> list[str]:
    """Check the section rules: at least one non-empty section, at most 16, and the size limits."""
    problems = []
    if not any(section.text for section in sections):
        problems.append("no section with text")
    if len(sections) > MAX_SECTIONS:
        problems.append(f"{len(sections)} sections (maximum {MAX_SECTIONS})")
    for section in sections:
        if utf8_size(section.text) > MAX_SECTION_BYTES:
            problems.append(f"a [{section.kind}] section is {utf8_size(section.text)} bytes")
    for kind in ("commentary", "thinking"):
        combined = "\n".join(section.text for section in sections if section.kind == kind)
        if utf8_size(combined) > MAX_SECTION_BYTES:
            problems.append(f"combined [{kind}] text is {utf8_size(combined)} bytes")
    return problems


def tagged_text_problems(message: str) -> list[str]:
    """Return every way one assistant message breaks the Learn tagged-text rules."""
    return line_problems(message) + section_problems(split_sections(message))


def assistant_messages(response) -> list[str]:
    """Each assistant message in a response is checked on its own, as Agent Service does."""
    return [
        "".join(part.text for part in item.content if part.type == "output_text")
        for item in response.output
        if item.type == "message"
    ]


def print_tool_calls(response) -> None:
    """Show each MCP tool call, so a reviewer can see when the specialist searched the handbook."""
    for item in response.output:
        if item.type == "mcp_call":
            outcome = f"failed: {item.error}" if item.error else item.status or "completed"
            print(f"  Tool: {item.server_label}/{item.name} {item.arguments} -> {outcome}")
        elif item.type == "mcp_list_tools" and item.error:
            print(f"  Tool list from {item.server_label} failed: {item.error}")


def ask_specialist(openai_client, conversation_id: str, specialist_version: str, customer_turn: str) -> list[str]:
    """Send one customer turn, print the answer, and return its format problems."""
    started = time.monotonic()
    response = openai_client.responses.create(
        conversation=conversation_id,
        input=customer_turn,
        extra_body={
            "agent_reference": {"type": "agent_reference", "name": SPECIALIST_NAME, "version": specialist_version}
        },
    )
    print(f"\nCustomer: {customer_turn}")
    print(f"Specialist ({time.monotonic() - started:.1f} s):")
    print_tool_calls(response)
    problems = []
    messages = assistant_messages(response)
    for message in messages:
        print("  " + message.strip().replace("\n", "\n  "))
        problems += tagged_text_problems(message)
    # Not a Learn rule: the specialist's own instructions require a spoken [commentary] answer.
    if not any(section.kind == "commentary" for message in messages for section in split_sections(message)):
        problems.append("no [commentary] section, so the voice agent has nothing to say")
    print("  Format: OK" if not problems else "  Format problems: " + "; ".join(problems))
    return problems


def run_scenario(openai_client, specialist_version: str, name: str, customer_turns: list[str]) -> int:
    """Run one scenario in a fresh conversation and return the number of format problems."""
    print(f"\n=== {name} ===")
    conversation = openai_client.conversations.create()
    try:
        return sum(
            len(ask_specialist(openai_client, conversation.id, specialist_version, turn))
            for turn in customer_turns
        )
    finally:
        openai_client.conversations.delete(conversation_id=conversation.id)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), help="run one scenario (default: all)")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    # Answers can hold characters the Windows console code page can't encode.
    sys.stdout.reconfigure(encoding="utf-8")
    load_azd_env()
    scenario_names = [args.scenario] if args.scenario else list(SCENARIOS)
    with azd_credential() as credential, AIProjectClient(
        endpoint=require_env("FOUNDRY_PROJECT_ENDPOINT"), credential=credential, allow_preview=True
    ) as project, project.get_openai_client() as openai_client:
        specialist_version = pinned_specialist_version(project)
        print(f"Testing {SPECIALIST_NAME}:{specialist_version}")
        problem_count = sum(
            run_scenario(openai_client, specialist_version, name, SCENARIOS[name]) for name in scenario_names
        )
    print(f"\n{problem_count} format problem(s).")
    return 1 if problem_count else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ConfigError as error:
        sys.exit(f"Error: {error}")
    except HttpResponseError as error:
        sys.exit(f"Foundry request failed (HTTP {error.status_code}): {error.message}")
    except APIError as error:
        sys.exit(f"Responses request failed: {error.message}")
