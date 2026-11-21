// One GPT-Live call, ported from the official sample's LiveSession
// (microsoft/voice-agent samples/gpt_live/js/public/live-session.js).
import {
  VoiceAgentLiveClient,
  type VoiceAgentLiveConnection,
  type VoiceAgentLiveEvent,
} from "@azure/ai-projects";
import type { TokenCredential } from "@azure/core-auth";

import { CallError, COMMAND } from "./failures";
import { fatalError } from "./state";
import { BrowserWebSocketTransport } from "./transport";

/**
 * Microphone audio older than this is dropped rather than sent. Late audio is no use to a live
 * conversation, and GPT-Live drops audio that arrives faster than 1.2x real time or in bursts
 * over 5 seconds, which is what a backlog becomes once a stall ends.
 */
const MAX_AUDIO_AGE_MS = 1000;
/** About a second of audio events (each 100 ms chunk is about 6.5 KB of JSON). */
const MAX_SEND_BACKLOG_BYTES = 64 * 1024;

export interface LiveCallOptions {
  endpoint: string;
  agentName: string;
  credential: TokenCredential;
  /** Every event except output audio, after the fatal-error check. */
  onEvent: (event: VoiceAgentLiveEvent) => void;
  /** Base64 PCM16 audio at 24 kHz to play. */
  onAudio: (base64: string) => void;
  /** The session started; the page can start sending microphone audio. */
  onReady: () => void;
  /** A typed message is about to be sent. */
  onTyped: (text: string) => void;
  /** Microphone audio started being dropped because it couldn't be sent in time. */
  onAudioDropped: () => void;
}

export class LiveCall {
  private connection?: VoiceAgentLiveConnection;
  private transport?: BrowserWebSocketTransport;
  /** Cancels connect() when the call is ended before the session starts. */
  private readonly connecting = new AbortController();
  private ready = false;
  private stopping = false;
  private sending: Promise<void> = Promise.resolve();
  private audioChunks = 0;
  private droppingAudio = false;

  constructor(private readonly options: LiveCallOptions) {}

  /** Connects, reads events until the session ends, and throws if it fails. */
  async run(): Promise<void> {
    const { endpoint, agentName, credential, onEvent, onAudio, onReady } = this.options;
    const live = new VoiceAgentLiveClient(endpoint, credential, {
      webSocketFactory: { create: () => (this.transport = new BrowserWebSocketTransport()) },
    });
    // Opens the agent's .../protocols/voice/live/sessions WebSocket and resolves once Foundry
    // sends session.started; the iterator below still receives that event. Aborting rejects it
    // and closes the socket.
    this.connection = await live.connect(agentName, { abortSignal: this.connecting.signal });
    try {
      for await (const event of this.connection) {
        const fatal = fatalError(event);
        if (fatal) throw new CallError(fatal.message, fatal.detail);
        if (event.type === "session.output_audio.delta") {
          try {
            onAudio(event.delta);
          } catch (error) {
            console.warn("Skipped an audio chunk that GPT-Live sent", error);
          }
          continue;
        }
        // The SDK's guidance: most errors are recoverable and the session stays open, so log them.
        if (event.type === "error") console.warn("GPT-Live error", event.error);
        if (event.type === "info") console.info("GPT-Live info", event.code, event.message);
        onEvent(event);
        // A call ended just as the session started has already released the microphone.
        if (event.type === "session.started" && !this.stopping) {
          this.ready = true;
          onReady();
        }
      }
    } catch (error) {
      this.stopping = true;
      await this.connection.close().catch(() => {});
      throw error;
    }
  }

  /** Streams one PCM16 microphone chunk, captured ageMs ago, once the session has started. */
  sendAudio(chunk: ArrayBuffer, ageMs = 0): void {
    const connection = this.connection;
    if (!connection || this.stopping || !this.ready) return;
    if (ageMs > MAX_AUDIO_AGE_MS || (this.transport?.bufferedAmount ?? 0) > MAX_SEND_BACKLOG_BYTES) {
      if (!this.droppingAudio) {
        this.droppingAudio = true;
        console.warn(`Dropping late microphone audio (${Math.round(ageMs)} ms old, ${this.transport?.bufferedAmount} bytes queued)`);
        this.options.onAudioDropped();
      }
      return;
    }
    this.droppingAudio = false;
    const bytes = new Uint8Array(chunk);
    const pcm = bytes.subarray(0, bytes.length - (bytes.length % 2));
    const eventId = `${COMMAND.audio}${++this.audioChunks}`;
    // A send fails only once the socket is closing; the event loop reports why.
    this.sending = this.sending.then(() => connection.sendAudio(pcm, { eventId })).catch(() => {});
  }

  /**
   * Sends a typed message: a user message item, then a request to answer it. Foundry runs the
   * managed agent and GPT-Live speaks the reply. SDK 2.11.0 refuses both commands outside
   * Responses delegation, so, as the official sample does, they go straight to the socket.
   */
  async sendText(text: string): Promise<void> {
    if (!this.transport || this.stopping || !this.ready) throw new Error("The call is not ready.");
    const id = crypto.randomUUID();
    this.options.onTyped(text);
    const item = { type: "message", role: "user", content: [{ type: "input_text", text }] };
    await this.transport.send(JSON.stringify({ type: "response.item.create", event_id: `${COMMAND.typed}item-${id}`, item }));
    await this.transport.send(JSON.stringify({ type: "response.create", event_id: `${COMMAND.typed}run-${id}` }));
  }

  /** Mutes or unmutes the model's audio input; the service confirms with session.input_audio.(un)muted. */
  async setMuted(muted: boolean): Promise<void> {
    if (!this.connection || this.stopping || !this.ready) return;
    const eventId = `${muted ? COMMAND.mute : COMMAND.unmute}${crypto.randomUUID()}`;
    await (muted ? this.connection.muteInputAudio({ eventId }) : this.connection.unmuteInputAudio({ eventId }));
  }

  /** Cancels the connection attempt, or sends session.close, waits for session.closed, then closes the socket. */
  stop(): void {
    if (this.stopping) return;
    this.stopping = true;
    if (!this.connection) {
      this.connecting.abort();
      return;
    }
    this.connection.close().catch((error: unknown) => console.warn("GPT-Live close failed", error));
  }
}
