import { type RefObject, useEffect } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";

/** How many frequency bands of the agent's voice the avatar's voice ring shows. */
export const VOICE_BANDS = 16;
/** Speech RMS rarely passes 0.2, so 0.2 counts as full volume. */
const FULL_VOLUME_RMS = 0.2;
/** How far `--level` moves towards the current level each frame, so it rises and falls smoothly. */
const SMOOTHING = 0.25;

/** Whose voice is measured: the microphone's or the agent's. */
export type LevelSource = "input" | "output";

export interface AudioMeters {
  /** The microphone and agent audio levels, 0 to 1. */
  levels: () => Record<LevelSource, number>;
  /** The agent's voice in `count` frequency bands, low to high, each 0 to 1. */
  voiceBands: (count: number) => number[];
}

/**
 * Writes the live audio level (0 to 1) of the microphone or the agent's voice to the CSS variable
 * `--level` on `ref`'s element, once per animation frame. Everything inside that reads the
 * variable moves with the voice: the avatar's ring and glow, and the status pill's bars. While
 * the agent's voice is the source, its frequency bands go to `--band-0` and up, for the
 * avatar's voice ring.
 *
 * Writing CSS variables rather than React state keeps the page from re-rendering 60 times a
 * second. With no `source`, the variables are removed and the CSS defaults apply. With reduced
 * motion, `--level` is removed so nothing moves with it, but the voice bands still go out: the
 * avatar's voice ring then fades with the voice instead of moving.
 */
export function useAudioLevel(
  ref: RefObject<HTMLElement | null>,
  { levels, voiceBands }: AudioMeters,
  source: LevelSource | undefined,
) {
  const moving = !useMediaQuery("(prefers-reduced-motion: reduce)");
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const clear = () => {
      element.style.removeProperty("--level");
      for (let band = 0; band < VOICE_BANDS; band++) element.style.removeProperty(`--band-${band}`);
    };
    if (!source || (!moving && source !== "output")) {
      clear();
      return;
    }
    let smoothed = 0;
    let frame = requestAnimationFrame(function animate() {
      if (moving) {
        const target = Math.min(1, levels()[source] / FULL_VOLUME_RMS);
        smoothed += (target - smoothed) * SMOOTHING;
        element.style.setProperty("--level", smoothed.toFixed(3));
      }
      if (source === "output") {
        voiceBands(VOICE_BANDS).forEach((value, band) => element.style.setProperty(`--band-${band}`, value.toFixed(3)));
      }
      frame = requestAnimationFrame(animate);
    });
    return () => {
      cancelAnimationFrame(frame);
      clear();
    };
  }, [ref, levels, voiceBands, source, moving]);
}