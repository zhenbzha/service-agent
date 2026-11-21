import { LoaderCircleIcon, MicOffIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CallActivity } from "@/lib/live/state";

/** What the call card says about the call: its activity ("idle" reads "Online"), or how it failed. */
export type PillKind = CallActivity | "failed" | "dropped";

type Tone = "lime" | "neutral" | "rose";
type Mark = "dot" | "spin" | "mic-off" | "bars";

// Checking stays lime because it is progress, not a warning; muted is neutral because it is the
// customer's choice, not a fault. Only a call that failed is rose.
const PILLS: Record<PillKind, { text: string; tone: Tone; mark: Mark }> = {
  idle: { text: "Online", tone: "lime", mark: "dot" },
  connecting: { text: "Connecting…", tone: "neutral", mark: "spin" },
  listening: { text: "Listening", tone: "lime", mark: "bars" },
  speaking: { text: "Speaking", tone: "lime", mark: "bars" },
  checking: { text: "Checking with specialist", tone: "lime", mark: "spin" },
  muted: { text: "Mic off", tone: "neutral", mark: "mic-off" },
  ending: { text: "Ending…", tone: "neutral", mark: "spin" },
  ended: { text: "Call ended", tone: "neutral", mark: "dot" },
  failed: { text: "Couldn't start", tone: "rose", mark: "dot" },
  dropped: { text: "Call dropped", tone: "rose", mark: "dot" },
};

const TONES: Record<Tone, { pill: string; dot: string }> = {
  lime: { pill: "bg-lime-300/10 text-lime-200 ring-lime-300/20", dot: "bg-lime-300" },
  neutral: { pill: "bg-white/[0.06] text-white/70 ring-white/10", dot: "bg-white/40" },
  rose: { pill: "bg-rose-500/10 text-rose-300 ring-rose-400/25", dot: "bg-rose-400" },
};

// The three level bars' relative heights, like a small equaliser.
const BARS = [0.55, 1, 0.4];

/** The call's state in a word or two. A status role, so screen readers announce each change. */
export function StatusPill({ kind }: { kind: PillKind }) {
  const { text, tone, mark } = PILLS[kind];
  return (
    <p
      role="status"
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium whitespace-nowrap ring-1",
        TONES[tone].pill,
      )}
    >
      {mark === "dot" && <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONES[tone].dot)} />}
      {mark === "spin" && (
        <LoaderCircleIcon aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />
      )}
      {mark === "mic-off" && <MicOffIcon aria-hidden="true" className="size-3" />}
      {mark === "bars" && (
        // The bars read --level, which useAudioLevel sets on an ancestor; .4 is the resting height.
        <span aria-hidden="true" className="flex h-2.5 items-center gap-[2px]">
          {BARS.map((k, index) => (
            <span
              key={index}
              className="w-[2px] rounded-full bg-lime-300"
              style={{ height: `calc(3px + var(--level, 0.4) * ${k * 7}px)` }}
            />
          ))}
        </span>
      )}
      {text}
    </p>
  );
}
