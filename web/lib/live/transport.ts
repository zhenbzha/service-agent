// The GPT-Live WebSocket transport for the browser, ported from the official sample
// (microsoft/voice-agent samples/gpt_live/js/public/live-transport.js).
//
// Browsers cannot set handshake headers, so the SDK's bearer token is offered as the
// "authorization.bearer.<token>" subprotocol next to "live", and the preview and request-ID
// headers become query parameters. The SDK's built-in browser transport does the same, but it
// is not exported; the sample supplies its own so the page can also send the two typed-message
// commands that SDK 2.11.0 refuses in Foundry-managed sessions (see call.ts).
import type {
  VoiceAgentWebSocketConnectOptions,
  VoiceAgentWebSocketHandlers,
  VoiceAgentWebSocketTransport,
} from "@azure/ai-projects";

const LIVE_SUBPROTOCOL = "live";
const BEARER_OFFER = "authorization.bearer.";
const HEADER_QUERY_PARAMETERS: Record<string, string> = {
  "foundry-features": "foundry_features",
  "x-ms-client-request-id": "client-request-id",
};

export function browserLiveUrl(url: string, headers: Record<string, string> = {}): string {
  const target = new URL(url);
  for (const [name, value] of Object.entries(headers)) {
    const parameter = HEADER_QUERY_PARAMETERS[name.toLowerCase()];
    if (parameter) target.searchParams.set(parameter, value);
  }
  return target.toString();
}

export class BrowserWebSocketTransport implements VoiceAgentWebSocketTransport {
  private handlers?: VoiceAgentWebSocketHandlers;
  private socket?: WebSocket;

  setHandlers(handlers: VoiceAgentWebSocketHandlers): void {
    this.handlers = handlers;
  }

  async connect({
    url,
    headers,
    connectionTimeoutInMs,
    abortSignal,
  }: VoiceAgentWebSocketConnectOptions): Promise<void> {
    const token = /^Bearer (\S+)$/.exec(headers.authorization ?? "")?.[1];
    if (!token) throw new Error("The SDK supplied no bearer token for the Live handshake.");
    if (abortSignal?.aborted) throw new Error("WebSocket connection was cancelled.");

    const socket = new WebSocket(browserLiveUrl(url, headers), [LIVE_SUBPROTOCOL, BEARER_OFFER + token]);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("message", (event) => this.handlers?.onMessage(event.data));
    socket.addEventListener("close", (event) =>
      this.handlers?.onClose(event.code, event.reason, event.wasClean),
    );
    // Browser error events carry no details; a close event with its code follows.
    socket.addEventListener("error", () =>
      this.handlers?.onError(new Error("The GPT-Live WebSocket failed.")),
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => fail(new Error(`WebSocket connection timed out after ${connectionTimeoutInMs}ms.`)),
        connectionTimeoutInMs,
      );
      const onAbort = () => fail(new Error("WebSocket connection was cancelled."));
      const onOpen = () => {
        settle();
        resolve();
      };
      // Browsers hide the HTTP status of a refused upgrade; it surfaces as an error or a close.
      const onRefused = () =>
        fail(
          new Error(
            "Foundry refused the GPT-Live connection. Check that your account can use the Foundry project.",
          ),
        );
      function settle() {
        clearTimeout(timeout);
        abortSignal?.removeEventListener("abort", onAbort);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onRefused);
        socket.removeEventListener("close", onRefused);
      }
      function fail(error: Error) {
        settle();
        if (socket.readyState !== WebSocket.CLOSED) socket.close();
        reject(error);
      }
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onRefused);
      socket.addEventListener("close", onRefused);
      abortSignal?.addEventListener("abort", onAbort);
    });

    // Foundry selects only "live" and never echoes the credential offer.
    if (socket.protocol !== LIVE_SUBPROTOCOL) {
      socket.close();
      throw new Error(`Foundry did not select the '${LIVE_SUBPROTOCOL}' WebSocket subprotocol.`);
    }
  }

  async send(data: string): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not connected.");
    this.socket.send(data);
  }

  /** Bytes queued by send() that the browser hasn't put on the network yet. */
  get bufferedAmount(): number {
    return this.socket?.bufferedAmount ?? 0;
  }

  async close(code: number, reason: string): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    // Browsers only send 1000 or 3000-4999; the SDK may ask for others, such as 1002.
    const browserCode = code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 5000);
      socket.addEventListener(
        "close",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.close(browserCode, reason?.slice(0, 120));
    });
  }
}
