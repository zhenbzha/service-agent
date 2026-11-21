// What the customer sees when something goes wrong. GPT-Live's contract (the Live server-events
// reference and SDK @azure/ai-projects 2.11.0): an `error` event reports a problem, usually a
// rejected client command named by its client_event_id, and the session stays open. Only
// session.closed or the socket closing ends a session. So a call ends only then, or when the
// page itself can't go on (see fatalError in state.ts); every other error is logged, and shown
// only when it is about something the customer did.
import {
  VoiceAgentAuthenticationError,
  VoiceAgentConnectionError,
  VoiceAgentProtocolError,
} from "@azure/ai-projects";

/** Why a call ended early or couldn't start: a message for the customer, then technical detail. */
export interface CallFailure {
  message: string;
  detail?: string;
}

/** An error whose message is already written for the customer. */
export class CallError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CallError";
  }
}

/** Prefixes of the event_ids the page gives its commands, so an error event names its cause. */
export const COMMAND = {
  audio: "audio-",
  mute: "mute-",
  unmute: "unmute-",
  typed: "typed-",
} as const;

export const CONNECTION_LOST = "The connection to the voice service was lost.";
export const UNSTABLE_CONNECTION = "Your connection is unstable, so the agent may miss some of what you say.";

/** The message of an error and of each error that caused it, as one line of detail. */
function detailOf(error: unknown): string | undefined {
  const parts: string[] = [];
  for (let cause = error; cause instanceof Error && parts.length < 4; cause = cause.cause) {
    if (cause.message && !parts.includes(cause.message)) parts.push(cause.message);
    if (cause instanceof VoiceAgentConnectionError && cause.closeCode) parts.push(`Close code ${cause.closeCode}.`);
  }
  return parts.join(" ") || (error instanceof Error ? undefined : String(error));
}

/** Turns whatever a call threw into what the customer sees. */
export function describeFailure(error: unknown): CallFailure {
  if (error instanceof CallError) return { message: error.message, detail: error.detail };
  const detail = detailOf(error);
  if (error instanceof VoiceAgentAuthenticationError) {
    return { message: "You couldn't be signed in to the voice service. Sign in again, then try again.", detail };
  }
  if (error instanceof VoiceAgentConnectionError) {
    if (error.code === "connectionClosed") return { message: CONNECTION_LOST, detail };
    return { message: "The voice service couldn't be reached. Check your connection, then try again.", detail };
  }
  if (error instanceof VoiceAgentProtocolError) {
    return { message: "The voice service sent something this page couldn't read.", detail };
  }
  return { message: "Something went wrong with the call.", detail };
}
