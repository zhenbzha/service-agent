import type { TokenCredential } from "@azure/core-auth";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { PcmAudio } from "@/lib/audio/pcm-audio";
import { LiveCall } from "@/lib/live/call";
import { CallError, describeFailure, UNSTABLE_CONNECTION } from "@/lib/live/failures";
import { callReducer, initialCallState } from "@/lib/live/state";

export interface LiveCallSettings {
  endpoint: string;
  agentName: string;
  credential: TokenCredential;
}

/** One channel with the browser's voice processing, as in the official sample. */
const MICROPHONE: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** Asks for the microphone and turns the browser's refusals into messages a customer can act on. */
async function openMicrophone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: MICROPHONE });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : undefined;
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const options = { cause: error };
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new CallError("We can't hear you. Allow microphone access in your browser, then start the call again.", detail, options);
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new CallError("No microphone was found. Connect one, then start the call again.", detail, options);
    }
    if (name === "NotReadableError" || name === "AbortError") {
      throw new CallError("Your microphone couldn't be started. Close other apps that use it, then try again.", detail, options);
    }
    throw new CallError("Your microphone couldn't be opened.", detail, options);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs GPT-Live calls for the page: microphone in, agent audio out, and the call state from the
 * reducer. The flow follows the official sample's start and stop handlers
 * (microsoft/voice-agent samples/gpt_live/js/public/app.js).
 */
export function useLiveCall({ endpoint, agentName, credential }: LiveCallSettings) {
  const [state, dispatch] = useReducer(callReducer, initialCallState);
  const [playing, setPlaying] = useState(false);
  const call = useRef<LiveCall | undefined>(undefined);
  const audio = useRef<PcmAudio | undefined>(undefined);
  const microphone = useRef<MediaStream | undefined>(undefined);
  // Set when the call is ended while the browser is still asking for the microphone.
  const cancelled = useRef(false);

  const releaseMicrophone = useCallback(() => {
    audio.current?.stopCapture();
    for (const track of microphone.current?.getTracks() ?? []) track.stop();
    microphone.current = undefined;
  }, []);

  /** Starts a call. Call it from a click: browsers only allow audio playback after a user gesture. */
  const start = useCallback(async () => {
    // Create the audio context before anything else is awaited, so it counts as part of the click.
    // The previous call's context closes only now, so its last reply could finish playing.
    audio.current?.close();
    const player = new PcmAudio();
    audio.current = player;
    cancelled.current = false;
    dispatch({ type: "connecting" });
    /** Ends the call with a failure, unless the customer already hung up: then nothing failed for them. */
    const fail = (error: unknown) => {
      if (cancelled.current) {
        console.warn("The call failed after it was ended", error);
        return;
      }
      console.error("The call failed", error);
      dispatch({ type: "failed", failure: describeFailure(error) });
    };
    try {
      const mic = await openMicrophone();
      microphone.current = mic;
      if (cancelled.current) return;
      const live: LiveCall = new LiveCall({
        endpoint,
        agentName,
        credential,
        onEvent: (event) => dispatch({ type: "event", event, now: Date.now() }),
        onAudio: (base64) => player.play(base64),
        onReady: () => {
          player.startCapture(mic, (chunk, ageMs) => live.sendAudio(chunk, ageMs)).catch((error: unknown) => {
            fail(error);
            live.stop();
          });
        },
        onTyped: (text) => dispatch({ type: "typed", text }),
        onAudioDropped: () => dispatch({ type: "notice", message: UNSTABLE_CONNECTION }),
      });
      call.current = live;
      await live.run();
    } catch (error) {
      fail(error);
    } finally {
      releaseMicrophone();
      call.current = undefined;
      dispatch({ type: "closed", now: Date.now() });
    }
  }, [endpoint, agentName, credential, releaseMicrophone]);

  /** Hangs up: the microphone stops at once, and GPT-Live closes the session. */
  const end = useCallback(() => {
    cancelled.current = true;
    dispatch({ type: "ending" });
    releaseMicrophone();
    call.current?.stop();
  }, [releaseMicrophone]);

  /** Mutes the microphone for the agent; the state changes when GPT-Live confirms it. */
  const setMuted = useCallback((muted: boolean) => {
    call.current?.setMuted(muted).catch((error: unknown) => {
      dispatch({ type: "notice", message: `Couldn't ${muted ? "mute" : "unmute"} the microphone: ${messageOf(error)}` });
    });
  }, []);

  const sendText = useCallback((text: string) => {
    if (!call.current) return;
    call.current.sendText(text).catch((error: unknown) => {
      dispatch({ type: "notice", message: `Your message wasn't sent: ${messageOf(error)}` });
    });
  }, []);

  const dismissNotice = useCallback(() => dispatch({ type: "dismissNotice" }), []);

  /** The microphone and agent audio levels right now, for the call visual's animation frames. */
  const levels = useCallback(() => audio.current?.levels() ?? { input: 0, output: 0 }, []);
  /** The agent's voice in frequency bands right now, for the avatar's voice ring. */
  const voiceBands = useCallback((count: number) => audio.current?.voiceBands(count) ?? new Array<number>(count).fill(0), []);

  // Whether the agent's audio is playing; Web Audio has no event for this, so poll while live.
  const live = state.phase === "live";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setPlaying(audio.current?.playing ?? false), 100);
    return () => clearInterval(timer);
  }, [live]);

  // Leaving the page ends the call and frees the microphone and audio output.
  useEffect(
    () => () => {
      cancelled.current = true;
      call.current?.stop();
      releaseMicrophone();
      audio.current?.close();
    },
    [releaseMicrophone],
  );

  return {
    state,
    speaking: live && playing,
    start,
    end,
    setMuted,
    sendText,
    dismissNotice,
    levels,
    voiceBands,
  };
}

export type LiveCallControls = ReturnType<typeof useLiveCall>;
