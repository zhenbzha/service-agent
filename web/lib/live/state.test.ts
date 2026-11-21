import {
  VoiceAgentLiveClient,
  type VoiceAgentLiveEvent,
  type VoiceAgentWebSocketHandlers,
  type VoiceAgentWebSocketTransport,
} from "@azure/ai-projects";
import type { TokenCredential } from "@azure/core-auth";
import { describe, expect, it } from "vitest";

import recordedCall from "./fixtures/recorded-call.json";
import { CONNECTION_LOST, describeFailure, UNSTABLE_CONNECTION } from "./failures";
import {
  callActivity,
  callReducer,
  type CallAction,
  type CallState,
  fatalError,
  groupSources,
  initialCallState,
  parseTaggedText,
  visibleHandoffs,
} from "./state";

// recorded-call.json holds the wire messages of one real call (audio removed, handbook text
// shortened): the greeting, a typed question about a high bill, the billing specialist's
// hand-off with one handbook search, and the spoken answer. The tests replay wire messages
// through the SDK's own client, so the reducer sees exactly the events a browser would.

type WireMessage = Record<string, unknown>;

/** Delivers recorded wire messages to the SDK as Foundry would, then closes cleanly. */
class ReplayTransport implements VoiceAgentWebSocketTransport {
  private handlers?: VoiceAgentWebSocketHandlers;

  constructor(private readonly messages: readonly WireMessage[]) {}

  setHandlers(handlers: VoiceAgentWebSocketHandlers): void {
    this.handlers = handlers;
  }

  async connect(): Promise<void> {
    // Like a real socket: session.started arrives after the connection opened, and the rest of
    // the call after connect() returned. The SDK rejects a session that ended during startup.
    const [started, ...rest] = this.messages;
    setTimeout(() => {
      this.deliver(started);
      setTimeout(() => {
        rest.forEach((message) => this.deliver(message));
        this.handlers?.onClose(1000, "", true);
      });
    });
  }

  private deliver(message: WireMessage): void {
    this.handlers?.onMessage(JSON.stringify(message));
  }

  async send(): Promise<void> {}

  async close(): Promise<void> {}
}

const credential: TokenCredential = {
  getToken: async () => ({ token: "test-token", expiresOnTimestamp: Date.now() + 3_600_000 }),
};

async function sdkEvents(messages: readonly WireMessage[]): Promise<VoiceAgentLiveEvent[]> {
  const client = new VoiceAgentLiveClient("https://test.services.ai.azure.com/api/projects/test", credential, {
    webSocketFactory: { create: () => new ReplayTransport(messages) },
  });
  const events: VoiceAgentLiveEvent[] = [];
  for await (const event of await client.connect("voice-agent")) events.push(event);
  return events;
}

const sessionStarted = (format: WireMessage = { type: "audio/pcm", rate: 24000 }): WireMessage => ({
  type: "session.started",
  event_id: "event-started",
  session: { id: "live-test", audio: { output: { voice: "marin" }, format } },
});

const sessionClosed = (reason = "close_requested"): WireMessage => ({
  type: "session.closed",
  event_id: "event-closed",
  reason,
  session: { id: "live-test" },
  usage: {},
});

const delegationCreated = (id = "d1", target = "foundry_managed_agent"): WireMessage => ({
  type: "session.delegation.created",
  event_id: `event-created-${id}`,
  offset_ms: 0,
  delegation: { id, type: "delegation", target },
});

const delegationDone = (status: string, errorCode?: string): WireMessage => ({
  type: "session.delegation.done",
  event_id: "event-done",
  delegation_id: "d1",
  status,
  error_code: errorCode,
});

/** The SDK events of a short call: the given messages between session.started and session.closed. */
const shortCall = (messages: readonly WireMessage[]) => sdkEvents([sessionStarted(), ...messages, sessionClosed()]);

/** The call state after the given actions. */
function reduce(actions: readonly CallAction[]): CallState {
  return actions.reduce(callReducer, callReducer(initialCallState, { type: "connecting" }));
}

/** One reducer action per event, with event times counting up from 0. */
const asActions = (events: readonly VoiceAgentLiveEvent[]): CallAction[] =>
  events.map((event, index) => ({ type: "event", event, now: index }));

describe("a recorded call", async () => {
  const events = await sdkEvents(recordedCall as WireMessage[]);
  // The customer typed their question once the greeting ended, just before the hand-off.
  const handoffAt = events.findIndex((event) => event.type === "session.delegation.created");
  const typed: CallAction = {
    type: "typed",
    text: "Hi, my customer number is 100245 and my postcode is 00150. Why is my bill so high this month?",
  };
  const actions = asActions(events);
  const state = reduce([...actions.slice(0, handoffAt), typed, ...actions.slice(handoffAt), { type: "closed", now: 999 }]);

  it("has no fatal event", () => {
    expect(events.map((event) => fatalError(event)).filter(Boolean)).toEqual([]);
  });

  it("keeps the conversation in speaking order", () => {
    expect(state.turns.map((turn) => [turn.speaker, turn.typed])).toEqual([
      ["agent", false],
      ["customer", true],
      ["agent", false],
    ]);
    expect(state.turns[0].text).toMatch(/^ ?Hi, thanks for calling Zava Energy\./);
    expect(state.turns[2].text).toMatch(/Your October bill jumped because it was estimated/);
  });

  it("records the hand-off with its handbook search and guidance", () => {
    expect(state.handoffs).toHaveLength(1);
    const [handoff] = state.handoffs;
    expect(handoff).toMatchObject({ agent: "billing-specialist", model: "gpt-5.5", status: "answered", afterTurns: 2 });
    expect(handoff.finishedAt).toBeGreaterThan(handoff.startedAt);
    expect(handoff.tools).toEqual([
      {
        id: expect.any(String),
        name: "knowledge_base_retrieve",
        status: "done",
        queries: [
          "estimated meter reading invoice correction actual reading",
          "high bill estimated consumption fixed price",
        ],
        sources: [1, 2, 4, 5, 6].map((page) => ({ file: "zava-energy-billing-handbook.pdf", page })),
      },
    ]);
    const [guidance] = parseTaggedText(handoff.guidance);
    expect(guidance.kind).toBe("commentary");
    expect(guidance.text).toMatch(/^Your October bill is high because it was based on an estimated 1,450/);
  });

  it("ends with the reason the session closed", () => {
    expect(state).toMatchObject({ phase: "ended", closeReason: "close_requested", endedAt: 999 });
    expect(state.failure).toBeUndefined();
  });
});

describe("failures", () => {
  const error = (clientEventId?: string): WireMessage => ({
    type: "error",
    event_id: "event-error",
    error: { type: "invalid_request_error", code: "invalid_value", message: "Rejected.", client_event_id: clientEventId },
  });

  it.each([
    ["audio at another sample rate", [sessionStarted({ type: "audio/pcm", rate: 16000 }), sessionClosed()], /PCM16 audio at 24 kHz/],
    ["audio without a sample rate", [sessionStarted({ type: "audio/pcm" }), sessionClosed()], /PCM16 audio at 24 kHz/],
    [
      "a delegation the client would have to run",
      [sessionStarted(), delegationCreated("d1", "client"), sessionClosed()],
      /Expected a Foundry-managed delegation/,
    ],
  ])("end the call on %s", async (_, messages, expected) => {
    const failures = (await sdkEvents(messages)).map((event) => fatalError(event)?.detail);
    expect(failures.filter(Boolean)).toEqual([expect.stringMatching(expected)]);
  });

  it.each([
    ["a rejected typed message", "typed-item-1", "Your typed message was not accepted: Rejected."],
    ["rejected microphone audio, such as audio arriving too quickly", "audio-42", UNSTABLE_CONNECTION],
    ["a rejected mute", "mute-1", "Couldn't mute the microphone. Try again."],
    ["an error about no command of the page", "other-event", undefined],
    ["an error about no command at all", undefined, undefined],
  ])("keep the call going on %s, and tell the customer only when it affects them", async (_, command, notice) => {
    const events = await shortCall([error(command)]);
    expect(events.map((event) => fatalError(event)).filter(Boolean)).toEqual([]);
    const state = reduce(asActions(events.slice(0, 2)));
    expect(state.phase).toBe("live");
    expect(state.notice).toBe(notice);
    expect(state.failure).toBeUndefined();
  });

  it.each([
    ["connection_lost", CONNECTION_LOST],
    ["expired", "The call reached its time limit."],
    ["content", "The call was ended by the content safety filter."],
    ["close_requested", undefined],
    ["remote_hangup", undefined],
  ])("explain why GPT-Live closed the session (%s)", async (reason, message) => {
    const events = await sdkEvents([sessionStarted(), sessionClosed(reason)]);
    expect(reduce(asActions(events)).failure?.message).toBe(message);
  });

  it.each([
    ["while connecting", 0],
    ["during the call", 1],
  ])("report no failure when the customer hangs up %s and the session then closes", async (_, hangUpAfter) => {
    const actions = asActions(await sdkEvents([sessionStarted(), sessionClosed("connection_lost")]));
    const state = reduce([...actions.slice(0, hangUpAfter), { type: "ending" }, ...actions.slice(hangUpAfter)]);
    expect(state).toMatchObject({ phase: "ending", closeReason: "connection_lost" });
    expect(state.failure).toBeUndefined();
  });

  it("explain a call that couldn't start or whose socket closed without session.closed", async () => {
    const refused = await sdkEvents([error()]).catch(describeFailure);
    expect(refused).toEqual({ message: expect.stringMatching(/couldn't be reached/), detail: "Rejected." });
    const dropped = await sdkEvents([sessionStarted()]).catch(describeFailure);
    expect(dropped).toEqual({ message: CONNECTION_LOST, detail: "Live socket closed without session.closed. Close code 1000." });
  });
});

describe("hand-offs", () => {
  it("keep the call going when the specialist's answer is rejected, and show the hand-off failed", async () => {
    // As recorded from a real call: Foundry rejected an answer over the tagged-text size limit.
    const events = await shortCall([
      delegationCreated(),
      {
        type: "error",
        event_id: "evt_managed_error_1",
        delegation_id: "d1",
        response_id: "resp_1",
        error: {
          type: "server_error",
          code: "result_too_large",
          message: "Delegated work did not complete. No final answer was accepted.",
          param: "delegation",
        },
      },
      delegationDone("failed", "result_too_large"),
    ]);
    expect(events.map((event) => fatalError(event)).filter(Boolean)).toEqual([]);
    const state = reduce(asActions(events));
    expect(state.handoffs[0]).toMatchObject({ status: "failed", failure: "failed (result_too_large)", startedAt: 1, finishedAt: 3 });
    expect(callActivity(state, false)).not.toBe("checking");
  });

  it("stay failed when the delegation completes after the specialist's response failed", async () => {
    const events = await shortCall([
      delegationCreated(),
      {
        type: "response.event",
        event_id: "event-backend",
        delegation_id: "d1",
        event: { type: "response.failed", response: { error: { message: "Model overloaded." } } },
      },
      delegationDone("completed"),
    ]);
    expect(reduce(asActions(events)).handoffs[0]).toMatchObject({ status: "failed", failure: "Model overloaded." });
  });

  it("hide a delegation that GPT-Live cancelled before it did any work", async () => {
    // GPT-Live can start two delegations for one utterance and cancel the one it doesn't need.
    const events = await shortCall([delegationCreated("d1"), delegationCreated("d2"), delegationDone("cancelled", "no_pending_input")]);
    const state = reduce(asActions(events));
    expect(state.handoffs.map((handoff) => [handoff.id, handoff.status])).toEqual([
      ["d1", "cancelled"],
      ["d2", "working"],
    ]);
    expect(visibleHandoffs(state.handoffs).map((handoff) => handoff.id)).toEqual(["d2"]);
  });

  it("sit between the agent turns before and after them", async () => {
    const agentSays = (delta: string): WireMessage => ({
      type: "session.output_transcript.delta",
      event_id: `event-${delta}`,
      start_ms: 0,
      end_ms: 200,
      delta,
    });
    const events = await shortCall([agentSays("Let me check."), delegationCreated(), agentSays("Your bill was estimated.")]);
    const state = reduce(asActions(events));
    expect(state.turns.map((turn) => turn.text)).toEqual(["Let me check.", "Your bill was estimated."]);
    expect(state.handoffs[0].afterTurns).toBe(1);
  });

  it("show as checking over the agent's voice, and mute only while the agent is quiet", async () => {
    const events = await shortCall([{ type: "session.input_audio.muted", event_id: "event-muted" }, delegationCreated()]);
    const [live, muted, checking] = [1, 2, 3].map((count) => reduce(asActions(events.slice(0, count))));
    expect([callActivity(live, false), callActivity(live, true)]).toEqual(["listening", "speaking"]);
    expect([callActivity(muted, false), callActivity(muted, true)]).toEqual(["muted", "speaking"]);
    expect(callActivity(checking, true)).toBe("checking");
  });

  it("list each file's pages once, in file and page order, across searches", () => {
    const sources = [
      { file: "b.pdf", page: 3 },
      { file: "a.pdf", page: 10 },
      { file: "b.pdf", page: 1 },
      { file: "a.pdf", page: 2 },
      { file: "a.pdf", page: 10 },
      { file: "c.pdf" },
    ];
    expect(groupSources(sources)).toEqual([
      { file: "a.pdf", pages: [2, 10] },
      { file: "b.pdf", pages: [1, 3] },
      { file: "c.pdf", pages: [] },
    ]);
  });
});
