import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { type LevelSource, VOICE_BANDS } from "@/hooks/use-audio-level";
import { PERSONA } from "@/lib/persona";
import type { CallActivity } from "@/lib/live/state";

interface Look {
  /** The lime glow's opacity at rest; the audio level adds to it. */
  glow: number;
  source?: LevelSource;
  /** A turning arc around the avatar, for waiting. */
  arc?: "fast" | "slow";
}

const LOOKS: Record<CallActivity, Look> = {
  idle: { glow: 0.18 },
  connecting: { glow: 0, arc: "fast" },
  ending: { glow: 0, arc: "fast" },
  listening: { glow: 0.15, source: "input" },
  speaking: { glow: 0.3, source: "output" },
  // The agent often speaks while the specialist works, so the glow follows its voice.
  checking: { glow: 0.18, source: "output", arc: "slow" },
  muted: { glow: 0.08 },
  ended: { glow: 0 },
};

/** The audio level that moves the avatar during `activity`, if any. */
export function levelSource(activity: CallActivity): LevelSource | undefined {
  return LOOKS[activity].source;
}

/**
 * The voice ring's bars, clockwise from the top and mirrored left and right, so each band of the
 * agent's voice moves a pair; the lowest band is at the top. CSS rotates a bar from pointing down.
 */
const VOICE_BARS = Array.from({ length: VOICE_BANDS * 2 }, (_, bar) => ({
  angle: 180 + ((bar + 0.5) * 360) / (VOICE_BANDS * 2),
  band: bar < VOICE_BANDS ? bar : VOICE_BANDS * 2 - 1 - bar,
}));

interface AgentAvatarProps {
  activity: CallActivity;
  size: "lg" | "sm";
  /** Greys the avatar out, after a call ends or fails. */
  dim?: boolean;
}

/**
 * The assistant's monogram on a lime disc. Its ring and glow grow with the `--level` CSS variable
 * that useAudioLevel sets on an ancestor. While the agent speaks, the large avatar's ring becomes
 * a ring of bars that follow the `--band-*` variables, as LiveKit's radial audio visualizer does
 * (AgentAudioVisualizerRadial in livekit/components-js). With reduced motion, the bars keep one
 * length and fade with the voice instead. Decorative: the status pill says the same in words.
 */
export function AgentAvatar({ activity, size, dim = false }: AgentAvatarProps) {
  const look = LOOKS[activity];
  const large = size === "lg";
  const voice = large && look.source === "output" && !dim;

  return (
    <div
      aria-hidden="true"
      className={cn("relative grid shrink-0 place-items-center", large ? "size-24 short:size-20" : "size-11")}
    >
      {activity === "idle" && large && !dim && (
        <span className="absolute inset-0 animate-ping-soft rounded-full ring-1 ring-lime-300/40 motion-reduce:hidden" />
      )}
      <span
        className={cn(
          "absolute inset-0 rounded-full ring-1 transition-[scale,opacity] duration-75 [scale:calc(1+var(--level,0)*0.16)]",
          dim ? "ring-white/15" : "ring-lime-300/35",
          voice && "opacity-0",
        )}
      />
      {large && (
        <span
          className={cn(
            "absolute inset-0 transition-opacity duration-300 ease-state [--voice-length:12px] [--voice-radius:50px] short:[--voice-length:10px] short:[--voice-radius:42px]",
            !voice && "opacity-0",
          )}
        >
          {VOICE_BARS.map(({ angle, band }) => (
            <span
              key={angle}
              className="absolute top-1/2 left-1/2 -ml-[1.5px] h-[calc(3px+var(--voice)*var(--voice-length))] w-[3px] origin-top rounded-full bg-lime-300/85 motion-reduce:h-[calc(3px+var(--voice-length)/2)] motion-reduce:opacity-[calc(0.2+var(--voice)*0.8)]"
              style={
                {
                  transform: `rotate(${angle}deg) translateY(var(--voice-radius))`,
                  "--voice": `var(--band-${band}, 0)`,
                } as CSSProperties
              }
            />
          ))}
        </span>
      )}
      <span
        className="absolute inset-[16%] rounded-full bg-lime-300 blur-xl transition-opacity duration-500 ease-state"
        style={{ opacity: dim ? 0 : `calc(${look.glow} + var(--level, 0) * 0.25)` }}
      />
      {look.arc && (
        <svg
          viewBox="0 0 100 100"
          className={cn(
            "absolute inset-0 size-full text-lime-300 motion-reduce:animate-none",
            look.arc === "fast" ? "animate-spin" : "animate-[spin_2.4s_linear_infinite]",
          )}
        >
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            stroke="currentColor"
            strokeWidth={large ? 1.5 : 3}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="22 78"
          />
        </svg>
      )}
      <div
        className={cn(
          "relative grid size-[76%] place-items-center overflow-hidden rounded-full bg-linear-to-br from-lime-200 via-lime-300 to-emerald-500 shadow-[0_8px_30px_-8px_oklch(0.897_0.196_126.7/0.55)] ring-2 ring-white/15 transition-[filter,opacity] duration-300 ease-state",
          dim && "opacity-80 saturate-[.35]",
        )}
      >
        <span
          className={cn(
            "font-semibold tracking-tight text-ink",
            large ? "text-[2rem] short:text-[1.75rem]" : "text-[15px]",
          )}
        >
          {PERSONA.initial}
        </span>
      </div>
    </div>
  );
}
