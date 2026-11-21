import { CircleAlertIcon, IdCardIcon, MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon } from "lucide-react";
import { useRef } from "react";

import { AgentAvatar, levelSource } from "@/components/voice/agent-avatar";
import { Conversation } from "@/components/voice/conversation";
import { RoundButton } from "@/components/voice/round-button";
import { type PillKind, StatusPill } from "@/components/voice/status-pill";
import { SuggestionChips, SuggestionList } from "@/components/voice/suggestions";
import { TypedMessage } from "@/components/voice/typed-message";
import { useAudioLevel } from "@/hooks/use-audio-level";
import { useElapsed } from "@/hooks/use-elapsed";
import type { LiveCallControls } from "@/hooks/use-live-call";
import { formatClock } from "@/lib/format";
import { PERSONA } from "@/lib/persona";
import { callActivity, visibleHandoffs } from "@/lib/live/state";
import { cn } from "@/lib/utils";

interface CallCardProps {
  call: LiveCallControls;
  onShowDemoCustomers: () => void;
  /**
   * "transcript" shows the conversation in the card, for phones. "call" shows the in-call screen
   * instead, for wide screens where the conversation has its own panel beside the card.
   */
  layout: "transcript" | "call";
}

/**
 * The call, on a card shaped like a phone. Before a call it shows who you are calling and what to
 * ask; once GPT-Live has started the session it shows the transcript, or the in-call screen, with
 * the controls docked below. A call that never started, cancelled or failed, stays on the first
 * view, so cancelling during connect doesn't flash an empty transcript.
 */
export function CallCard({ call, onShowDemoCustomers, layout }: CallCardProps) {
  const started = call.state.startedAt !== undefined;
  return (
    <CallSurface>
      {started ? (
        <LiveView key="live" call={call} layout={layout} />
      ) : (
        <IdleView key="idle" call={call} onShowDemoCustomers={onShowDemoCustomers} />
      )}
    </CallSurface>
  );
}

/**
 * The device frame: a gradient bezel, a dark rim and the screen. On phones the screen is the whole
 * page. `min-h-0` at every level lets the transcript scroll inside a card of fixed height.
 */
function CallSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto flex min-h-0 w-full flex-1 flex-col lg:h-[min(46rem,calc(100dvh-6.5rem))] lg:max-w-[28rem] lg:flex-none">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-8 left-1/2 h-12 w-[78%] -translate-x-1/2 rounded-[50%] bg-lime-300/20 blur-2xl max-lg:hidden"
      />
      <div className="relative flex min-h-0 flex-1 flex-col lg:rounded-[2.4rem] lg:bg-linear-to-b lg:from-white/[0.16] lg:via-white/[0.04] lg:to-white/[0.1] lg:p-px lg:shadow-[0_50px_100px_-30px_rgb(0_0_0/0.9),0_0_90px_-25px_oklch(0.897_0.196_126.7/0.3)]">
        <div className="flex min-h-0 flex-1 flex-col lg:rounded-[calc(2.4rem-1px)] lg:bg-rim lg:p-[7px]">
          <section
            aria-label="Call"
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:rounded-[1.95rem] lg:bg-screen"
          >
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 max-lg:hidden">
              <div className="absolute -top-28 left-1/2 size-72 -translate-x-1/2 rounded-full bg-lime-400/[0.16] blur-3xl" />
              <div className="absolute -right-24 -bottom-28 size-64 rounded-full bg-emerald-500/[0.12] blur-3xl" />
              <div className="absolute inset-0 bg-[linear-gradient(125deg,rgb(255_255_255/0.05)_0%,transparent_32%)]" />
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Before a call, while it connects, and after one that couldn't start. */
function IdleView({ call, onShowDemoCustomers }: Omit<CallCardProps, "layout">) {
  const { state } = call;
  const connecting = state.phase === "connecting";
  const cancelling = state.phase === "ending";
  const activity = connecting ? "connecting" : cancelling ? "ending" : "idle";
  const pill: PillKind = state.failure ? "failed" : activity;

  return (
    <div className="flex flex-1 animate-in flex-col overflow-y-auto px-5 pt-8 pb-6 duration-200 ease-enter fade-in-0 max-lg:pt-5 lg:px-6 short:pt-6 short:pb-5">
      <div className="flex flex-1 flex-col justify-center py-6 short:py-4">
        <div className="flex flex-col items-center text-center">
          <AgentAvatar activity={activity} size="lg" dim={state.failure !== undefined} />
          <h2 className="mt-4 text-[1.375rem] font-semibold tracking-tight short:mt-3">{PERSONA.name}</h2>
          <p className="mt-0.5 text-[13px] text-white/50">{PERSONA.role}</p>
          <div className="mt-3">
            <StatusPill kind={pill} />
          </div>
        </div>
        <div className="mt-7 short:mt-5">
          {state.failure ? (
            <div role="alert" className="flex gap-2.5 rounded-2xl bg-rose-500/[0.07] p-3.5 ring-1 ring-rose-400/20">
              <CircleAlertIcon aria-hidden="true" className="mt-px size-4 shrink-0 text-rose-300" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-rose-100">The call couldn&apos;t start</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-white/60">{state.failure.message}</p>
                <FailureDetail detail={state.failure.detail} />
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/[0.08]">
              <div className="px-3.5 pt-3.5 pb-1">
                <p className="label-caps">Try asking</p>
                <SuggestionList />
              </div>
              <div className="flex items-center gap-2.5 border-t border-white/[0.06] py-2.5 pr-2.5 pl-3.5">
                <IdCardIcon aria-hidden="true" className="size-4 shrink-0 text-white/45" />
                <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-white/55">
                  You&apos;ll be asked for a customer number and postcode.
                </p>
                <button
                  type="button"
                  onClick={onShowDemoCustomers}
                  className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium text-lime-200 ring-1 ring-lime-300/25 transition-colors hover:bg-lime-300/10"
                >
                  Demo accounts
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col items-center">
        {connecting || cancelling ? (
          <RoundButton
            tone="end"
            size="lg"
            icon={<PhoneOffIcon />}
            label="Cancel"
            disabled={cancelling}
            onClick={call.end}
          />
        ) : (
          <RoundButton
            tone="start"
            size="lg"
            icon={<PhoneIcon />}
            label={state.failure ? "Try again" : "Start call"}
            onClick={() => void call.start()}
          />
        )}
      </div>
    </div>
  );
}

/** From the moment GPT-Live starts the session until the customer starts another call. */
function LiveView({ call, layout }: { call: LiveCallControls; layout: CallCardProps["layout"] }) {
  const { state } = call;
  const ended = state.phase === "ended";
  const askedYet = state.turns.some((turn) => turn.speaker === "customer");
  // Below the transcript the dock needs a divider; below the in-call screen it doesn't.
  const divider = layout === "transcript" && "border-t border-white/[0.06]";

  return (
    <div className="flex min-h-0 flex-1 animate-in flex-col duration-200 ease-enter fade-in-0">
      {layout === "call" ? (
        <InCall call={call} />
      ) : (
        <>
          <PersonaRow call={call} />
          <Conversation turns={state.turns} handoffs={visibleHandoffs(state.handoffs)} />
        </>
      )}
      {ended ? (
        <div className={cn("relative px-4 pt-4 pb-5 max-lg:pb-[max(1.25rem,env(safe-area-inset-bottom))]", divider)}>
          {state.failure && (
            <div role="alert" className="mb-4 flex gap-2.5 rounded-xl bg-rose-500/[0.07] p-3 ring-1 ring-rose-400/20">
              <CircleAlertIcon aria-hidden="true" className="mt-px size-4 shrink-0 text-rose-300" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-rose-100">The call was cut off</p>
                <p className="mt-1 text-[12px] leading-relaxed text-white/55">{state.failure.message}</p>
                <FailureDetail detail={state.failure.detail} />
              </div>
            </div>
          )}
          <div className="flex justify-center">
            <RoundButton
              tone="start"
              icon={<PhoneIcon />}
              label={state.failure ? "Call again" : "New call"}
              onClick={() => void call.start()}
            />
          </div>
        </div>
      ) : (
        <div className={cn("relative px-4 pt-3 pb-4 max-lg:pb-[max(1rem,env(safe-area-inset-bottom))]", divider)}>
          {state.phase === "live" && !askedYet && <SuggestionChips onPick={call.sendText} />}
          <TypedMessage
            notice={state.notice}
            disabled={state.phase !== "live"}
            onSend={call.sendText}
            onDismissNotice={call.dismissNotice}
          />
          <div className="mt-3.5 flex items-start justify-center gap-12">
            {/* The label stays "Mute" while pressed: a toggle button reports its state with aria-pressed. */}
            <RoundButton
              tone="neutral"
              icon={state.muted ? <MicOffIcon /> : <MicIcon />}
              label="Mute"
              aria-label="Mute microphone"
              aria-pressed={state.muted}
              disabled={state.phase !== "live"}
              onClick={() => call.setMuted(!state.muted)}
            />
            <RoundButton
              tone="end"
              icon={<PhoneOffIcon />}
              label="End"
              aria-label="End call"
              disabled={state.phase !== "live"}
              onClick={call.end}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * What the in-call screen and the persona row show: the activity, its pill, whether the call is
 * over, and the call time. The audio level is written on the element `ref` is attached to, so the
 * avatar and the pill's bars move together from one animation loop. It is written there rather
 * than higher up, so each frame restyles only that element's subtree.
 */
function useCallStatus(call: LiveCallControls) {
  const { state } = call;
  const activity = callActivity(state, call.speaking);
  const ref = useRef<HTMLDivElement>(null);
  useAudioLevel(ref, call, levelSource(activity));
  const elapsed = useElapsed(state.startedAt, state.endedAt);
  const pill: PillKind = state.failure ? "dropped" : activity;
  const dim = state.phase === "ended" || state.failure !== undefined;
  return { ref, activity, pill, dim, elapsed };
}

/**
 * The in-call screen, for wide screens where the transcript has its own panel: who is on the call,
 * for how long, and what they are doing, large, as a phone shows a call.
 */
function InCall({ call }: { call: LiveCallControls }) {
  const { ref, activity, pill, dim, elapsed } = useCallStatus(call);

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col px-6 pt-8 short:pt-6">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <AgentAvatar activity={activity} size="lg" dim={dim} />
        <h2 className="mt-4 text-[1.375rem] font-semibold tracking-tight short:mt-3">{PERSONA.name}</h2>
        <p className="mt-1 font-mono text-[13px] text-white/55 tabular-nums">
          <span className="sr-only">Call time </span>
          {formatClock(elapsed)}
        </p>
        <div className="mt-3">
          <StatusPill kind={pill} />
        </div>
      </div>
    </div>
  );
}

/** Who is on the call, for how long, and what they are doing, in a row above the transcript. */
function PersonaRow({ call }: { call: LiveCallControls }) {
  const { ref, activity, pill, dim, elapsed } = useCallStatus(call);

  return (
    <div ref={ref} className="mx-3 mt-3 flex items-center gap-3 rounded-2xl bg-white/[0.04] p-2.5 pr-3 ring-1 ring-white/[0.08]">
      <AgentAvatar activity={activity} size="sm" dim={dim} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] leading-tight font-semibold tracking-tight">{PERSONA.name}</h2>
        <p className="mt-0.5 font-mono text-[11px] text-white/55 tabular-nums">
          <span className="sr-only">Call time </span>
          {formatClock(elapsed)}
        </p>
      </div>
      <StatusPill kind={pill} />
    </div>
  );
}

/** The technical reason under a failure's message, for whoever runs the demo. */
function FailureDetail({ detail }: { detail?: string }) {
  if (!detail) return null;
  return <p className="mt-1.5 font-mono text-[11px] leading-relaxed break-words text-white/50">{detail}</p>;
}
