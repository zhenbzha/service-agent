// The call's UI state, built from GPT-Live events by a pure reducer so it can be unit tested
// with recorded events. Event handling follows the official sample's LiveEventTranslator
// (microsoft/voice-agent samples/gpt_live/js/public/live-session.js), except for errors: see
// failures.ts.
import type { VoiceAgentLiveEvent } from "@azure/ai-projects";

import { type CallFailure, COMMAND, CONNECTION_LOST, UNSTABLE_CONNECTION } from "./failures";

/** PCM16 mono sample rate the page plays and captures; GPT-Live must negotiate the same. */
export const SAMPLE_RATE = 24000;

export type CallPhase = "idle" | "connecting" | "live" | "ending" | "ended";
export type Speaker = "customer" | "agent";
export type CloseReason = Extract<VoiceAgentLiveEvent, { type: "session.closed" }>["reason"];

export interface Turn {
  id: string;
  speaker: Speaker;
  text: string;
  /** Typed in the text box rather than spoken. */
  typed: boolean;
}

/** A handbook page the knowledge-base search returned. */
export interface Source {
  file: string;
  page?: number;
}

/** One knowledge-base search (an MCP tool call) the specialist made. */
export interface ToolCall {
  id: string;
  name?: string;
  status: "running" | "done" | "failed";
  queries: string[];
  sources: Source[];
}

/** One hand-off from the voice agent to the Foundry-managed specialist agent. */
export interface Handoff {
  id: string;
  agent?: string;
  model?: string;
  /** cancelled: GPT-Live dropped the delegation, for example a duplicate it no longer needed. */
  status: "working" | "answered" | "failed" | "cancelled";
  /** How many transcript turns came before the hand-off; the conversation shows it after them. */
  afterTurns: number;
  startedAt: number;
  finishedAt?: number;
  tools: ToolCall[];
  /** The specialist's raw tagged-text output, streamed; see parseTaggedText. */
  guidance: string;
  failure?: string;
  /** Why GPT-Live cancelled the delegation, for example "cancelled (no_pending_input)". */
  detail?: string;
}

export interface CallState {
  phase: CallPhase;
  startedAt?: number;
  endedAt?: number;
  turns: Turn[];
  handoffs: Handoff[];
  muted: boolean;
  closeReason?: CloseReason;
  /** Why the call ended early or couldn't start; set once, by the first failure. */
  failure?: CallFailure;
  /** A message that does not end the call, such as a rejected typed message. */
  notice?: string;
}

export type CallAction =
  | { type: "connecting" }
  | { type: "event"; event: VoiceAgentLiveEvent; now: number }
  | { type: "typed"; text: string }
  | { type: "ending" }
  | { type: "failed"; failure: CallFailure }
  | { type: "closed"; now: number }
  | { type: "notice"; message: string }
  | { type: "dismissNotice" };

export const initialCallState: CallState = {
  phase: "idle",
  turns: [],
  handoffs: [],
  muted: false,
};

/**
 * Why an event means this page can't go on with the call, or undefined: audio it can't play,
 * or a delegation it would have to run itself. Service errors never end a call; see failures.ts.
 */
export function fatalError(event: VoiceAgentLiveEvent): CallFailure | undefined {
  switch (event.type) {
    case "session.started": {
      const format = event.session.audio?.format;
      if (format && (format.type !== "audio/pcm" || !("rate" in format) || format.rate !== SAMPLE_RATE)) {
        return {
          message: "The voice agent uses an audio format this page can't play.",
          detail: "GPT-Live did not negotiate PCM16 audio at 24 kHz.",
        };
      }
      return undefined;
    }
    case "session.delegation.created":
      if (event.delegation.target !== "foundry_managed_agent") {
        return {
          message: "The voice agent is set up in a way this page doesn't support.",
          detail: `Expected a Foundry-managed delegation, but the target was '${event.delegation.target}'.`,
        };
      }
      return undefined;
    default:
      return undefined;
  }
}

/**
 * What to tell the customer about an error event, if anything. The call goes on either way. The
 * event names the rejected command by the event_id the page gave it (see COMMAND). Errors about
 * anything else are only logged; a failed hand-off (param "delegation") shows on the hand-off,
 * once session.delegation.done arrives.
 */
function errorNotice(event: Extract<VoiceAgentLiveEvent, { type: "error" }>): string | undefined {
  const command = event.error.client_event_id ?? event.client_event_id ?? "";
  if (command.startsWith(COMMAND.typed)) return `Your typed message was not accepted: ${event.error.message}`;
  // Such as "Input audio is arriving too quickly", after a network stall.
  if (command.startsWith(COMMAND.audio)) return UNSTABLE_CONNECTION;
  if (command.startsWith(COMMAND.mute)) return "Couldn't mute the microphone. Try again.";
  if (command.startsWith(COMMAND.unmute)) return "Couldn't unmute the microphone. Try again.";
  return undefined;
}

/** Why GPT-Live ended the session, when the customer didn't hang up and nothing else explains it. */
function closeFailure(reason: CloseReason): CallFailure | undefined {
  switch (reason) {
    case "connection_lost":
      return { message: CONNECTION_LOST, detail: "session.closed: connection_lost" };
    case "expired":
      return { message: "The call reached its time limit.", detail: "session.closed: expired" };
    case "content":
      return { message: "The call was ended by the content safety filter.", detail: "session.closed: content" };
    default:
      // close_requested and remote_hangup: someone hung up.
      return undefined;
  }
}

export interface GuidanceSection {
  /** commentary is what the customer should hear; thinking is context for the voice agent. */
  kind: "commentary" | "thinking";
  text: string;
}

/**
 * Splits the specialist's tagged text ("[commentary] …\n[thinking] …") into sections; see the
 * output format in agents/billing-specialist/instructions.md.
 */
export function parseTaggedText(text: string): GuidanceSection[] {
  const marks = [...text.matchAll(/\[(commentary|thinking)\]/g)];
  return marks
    .map((mark, index) => {
      const start = mark.index + mark[0].length;
      const end = marks[index + 1]?.index ?? text.length;
      return { kind: mark[1] as GuidanceSection["kind"], text: text.slice(start, end).trim() };
    })
    .filter((section) => section.text);
}

/** Reads the queries from an MCP call's JSON arguments. */
function parseQueries(argumentsJson: unknown): string[] {
  if (typeof argumentsJson !== "string" || !argumentsJson) return [];
  try {
    const value: unknown = JSON.parse(argumentsJson);
    const queries = (value as { queries?: unknown })?.queries;
    return Array.isArray(queries) ? queries.filter((query): query is string => typeof query === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Reads the retrieved documents' file names and page numbers from the output of the Foundry IQ
 * knowledge_base_retrieve tool: {"documents": [{"id", "content": "<JSON with file_name,
 * page_number>"}]}. Anything else yields no sources.
 */
function parseSources(outputJson: unknown): Source[] {
  if (typeof outputJson !== "string" || !outputJson) return [];
  let documents: unknown;
  try {
    documents = (JSON.parse(outputJson) as { documents?: unknown })?.documents;
  } catch {
    return [];
  }
  if (!Array.isArray(documents)) return [];
  const sources = new Map<string, Source>();
  for (const document of documents) {
    const content = (document as { content?: unknown })?.content;
    if (typeof content !== "string") continue;
    try {
      const fields = JSON.parse(content) as { file_name?: unknown; page_number?: unknown };
      if (typeof fields.file_name !== "string") continue;
      const page = typeof fields.page_number === "number" ? fields.page_number : undefined;
      sources.set(`${fields.file_name}#${page ?? ""}`, { file: fields.file_name, page });
    } catch {
      // Not a structured document; skip it.
    }
  }
  return [...sources.values()].sort(
    (a, b) => a.file.localeCompare(b.file) || (a.page ?? 0) - (b.page ?? 0),
  );
}

/** The pages per file across several searches' sources, sorted by file and page. */
export function groupSources(sources: readonly Source[]): { file: string; pages: number[] }[] {
  const pagesByFile = new Map<string, Set<number>>();
  for (const { file, page } of sources) {
    const pages = pagesByFile.get(file) ?? new Set<number>();
    if (page !== undefined) pages.add(page);
    pagesByFile.set(file, pages);
  }
  return [...pagesByFile]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, pages]) => ({ file, pages: [...pages].sort((a, b) => a - b) }));
}

/**
 * Adds speech to the transcript. A new turn starts whenever the other side spoke or typed, or a
 * hand-off started, so that the hand-off sits between what was said before and after it.
 */
function appendSpeech(state: CallState, speaker: Speaker, delta: string): Turn[] {
  const { turns } = state;
  const last = turns.at(-1);
  const handoffAfterLast = state.handoffs.at(-1)?.afterTurns === turns.length;
  if (last && last.speaker === speaker && !last.typed && !handoffAfterLast) {
    return [...turns.slice(0, -1), { ...last, text: last.text + delta }];
  }
  return [...turns, { id: `${speaker}-${turns.length}`, speaker, text: delta, typed: false }];
}

function updateHandoff(state: CallState, id: string, update: (handoff: Handoff) => Handoff): CallState {
  const index = state.handoffs.findIndex((handoff) => handoff.id === id);
  if (index < 0) return state;
  const handoffs = [...state.handoffs];
  handoffs[index] = update(handoffs[index]);
  return { ...state, handoffs };
}

function upsertTool(tools: ToolCall[], id: string, update: (tool: ToolCall) => ToolCall): ToolCall[] {
  const index = tools.findIndex((tool) => tool.id === id);
  if (index < 0) return [...tools, update({ id, status: "running", queries: [], sources: [] })];
  const next = [...tools];
  next[index] = update(next[index]);
  return next;
}

/** An MCP tool call item in the specialist's Responses stream. */
interface McpCallItem {
  type: "mcp_call";
  id: string;
  name?: string;
  status?: string;
  error?: unknown;
  arguments?: string;
  output?: string | null;
}

/**
 * The fields this page reads from the specialist's Responses stream events. The SDK types the
 * relayed event as Record<string, any>, so each field is checked before use.
 */
interface BackendEvent {
  type?: string;
  item_id?: string;
  arguments?: string;
  delta?: string;
  message?: string;
  item?: { type?: string } | McpCallItem;
  error?: { message?: string };
  response?: {
    model?: string;
    agent_reference?: { name?: string };
    error?: { message?: string } | null;
    incomplete_details?: { reason?: string } | null;
  };
}

function isMcpCall(item: BackendEvent["item"]): item is McpCallItem {
  return item?.type === "mcp_call" && typeof (item as McpCallItem).id === "string";
}

function toolStatus(item: McpCallItem, current: ToolCall["status"]): ToolCall["status"] {
  if (item.status === "completed") return "done";
  if (item.status === "failed" || item.error) return "failed";
  return current;
}

function backendFailure(backend: BackendEvent): string {
  return (
    backend.response?.error?.message ??
    backend.response?.incomplete_details?.reason ??
    backend.error?.message ??
    backend.message ??
    backend.type ??
    "unknown failure"
  );
}

/** Applies one event of the specialist's Responses stream, which GPT-Live relays as response.event. */
function applyBackendEvent(handoff: Handoff, backend: BackendEvent, now: number): Handoff {
  switch (backend.type) {
    case "response.created":
    case "response.in_progress":
      return {
        ...handoff,
        agent: backend.response?.agent_reference?.name ?? handoff.agent,
        model: backend.response?.model ?? handoff.model,
      };
    case "response.output_item.added":
    case "response.output_item.done": {
      const item = backend.item;
      if (!isMcpCall(item)) return handoff;
      const queries = parseQueries(item.arguments);
      return {
        ...handoff,
        tools: upsertTool(handoff.tools, item.id, (tool) => ({
          ...tool,
          name: item.name ?? tool.name,
          status: toolStatus(item, tool.status),
          queries: queries.length ? queries : tool.queries,
          sources: item.output ? parseSources(item.output) : tool.sources,
        })),
      };
    }
    case "response.mcp_call_arguments.done":
      if (typeof backend.item_id !== "string") return handoff;
      return {
        ...handoff,
        tools: upsertTool(handoff.tools, backend.item_id, (tool) => ({
          ...tool,
          queries: parseQueries(backend.arguments),
        })),
      };
    case "response.mcp_call.failed":
      if (typeof backend.item_id !== "string") return handoff;
      return {
        ...handoff,
        tools: upsertTool(handoff.tools, backend.item_id, (tool) => ({ ...tool, status: "failed" })),
      };
    case "response.output_text.delta":
      return { ...handoff, guidance: handoff.guidance + (backend.delta ?? "") };
    case "response.completed":
      return { ...handoff, status: "answered", finishedAt: handoff.finishedAt ?? now };
    case "response.failed":
    case "response.incomplete":
    case "error":
      // Foundry handles the fallback for managed delegations, so the call goes on. The failure
      // is only shown in the hand-off.
      return { ...handoff, status: "failed", finishedAt: handoff.finishedAt ?? now, failure: backendFailure(backend) };
    default:
      return handoff;
  }
}

/** The payload of session.delegation.done, which SDK 2.11.0 does not model yet. */
interface DelegationDone {
  delegation_id?: string;
  status?: string;
  error_code?: string | null;
}

function finishHandoff(handoff: Handoff, done: DelegationDone, now: number): Handoff {
  const finishedAt = handoff.finishedAt ?? now;
  // A delegation can complete after its response already reported a failure; keep the failure.
  if (done.status === "completed") {
    return { ...handoff, status: handoff.status === "failed" ? "failed" : "answered", finishedAt };
  }
  // GPT-Live cancels a delegation it no longer needs, such as one of two it started for the
  // same utterance (error code no_pending_input). Nothing went wrong, so it isn't a failure.
  if (done.status === "cancelled") {
    const detail = done.error_code ? `cancelled (${done.error_code})` : undefined;
    return { ...handoff, status: "cancelled", finishedAt, detail };
  }
  const reason = done.error_code ? `${done.status} (${done.error_code})` : (done.status ?? "failed");
  return { ...handoff, status: "failed", finishedAt, failure: handoff.failure ?? reason };
}

function applyEvent(state: CallState, event: VoiceAgentLiveEvent, now: number): CallState {
  switch (event.type) {
    case "session.started":
      // A call cancelled while connecting stays cancelled.
      return state.phase === "connecting" ? { ...state, phase: "live", startedAt: now } : state;
    case "session.input_transcript.delta":
      return { ...state, turns: appendSpeech(state, "customer", event.delta) };
    case "session.output_transcript.delta":
      return { ...state, turns: appendSpeech(state, "agent", event.delta) };
    case "session.input_audio.muted":
      return { ...state, muted: true };
    case "session.input_audio.unmuted":
      return { ...state, muted: false };
    case "session.delegation.created": {
      if (state.handoffs.some((handoff) => handoff.id === event.delegation.id)) return state;
      const handoff: Handoff = {
        id: event.delegation.id,
        status: "working",
        afterTurns: state.turns.length,
        startedAt: now,
        tools: [],
        guidance: "",
      };
      return { ...state, handoffs: [...state.handoffs, handoff] };
    }
    case "response.event":
      if (!event.delegation_id) return state;
      return updateHandoff(state, event.delegation_id, (handoff) => applyBackendEvent(handoff, event.event, now));
    case "unknown": {
      // Foundry sends session.delegation.done when a managed delegation finishes. SDK 2.11.0
      // passes it on as an unknown event that carries the service's payload.
      if (event.eventType !== "session.delegation.done") return state;
      const done = event.rawEvent as DelegationDone;
      if (!done.delegation_id) return state;
      return updateHandoff(state, done.delegation_id, (handoff) => finishHandoff(handoff, done, now));
    }
    case "error": {
      const notice = errorNotice(event);
      return notice ? { ...state, notice } : state;
    }
    case "session.closed": {
      // After the customer hangs up, how the session closed is no failure of theirs.
      const failure = state.failure ?? (state.phase === "ending" ? undefined : closeFailure(event.reason));
      return { ...state, closeReason: event.reason, failure };
    }
    default:
      return state;
  }
}

/** The hand-offs worth showing: a cancelled one that did no work is noise. */
export function visibleHandoffs(handoffs: readonly Handoff[]): Handoff[] {
  return handoffs.filter((handoff) => handoff.status !== "cancelled" || handoff.tools.length > 0 || handoff.guidance);
}

/** What the call is doing right now, as the call visual and its label show it. */
export type CallActivity =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "checking"
  | "muted"
  | "ending"
  | "ended";

/**
 * The call's current activity. `speaking` is whether the agent's audio is playing. A running
 * hand-off wins over speaking, because the agent usually fills the wait with a short line.
 */
export function callActivity(state: CallState, speaking: boolean): CallActivity {
  if (state.phase !== "live") return state.phase;
  if (state.handoffs.some((handoff) => handoff.status === "working")) return "checking";
  if (speaking) return "speaking";
  return state.muted ? "muted" : "listening";
}

export function callReducer(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case "connecting":
      return { ...initialCallState, phase: "connecting" };
    case "event":
      return applyEvent(state, action.event, action.now);
    case "typed":
      return {
        ...state,
        turns: [...state.turns, { id: `customer-${state.turns.length}`, speaker: "customer", text: action.text, typed: true }],
      };
    case "ending":
      return state.phase === "live" || state.phase === "connecting" ? { ...state, phase: "ending" } : state;
    case "failed":
      return { ...state, failure: state.failure ?? action.failure };
    case "closed":
      return { ...state, phase: "ended", endedAt: action.now };
    case "notice":
      return { ...state, notice: action.message };
    case "dismissNotice":
      return { ...state, notice: undefined };
  }
}
