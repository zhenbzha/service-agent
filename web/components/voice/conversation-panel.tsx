import { Conversation } from "@/components/voice/conversation";
import type { Handoff, Turn } from "@/lib/live/state";

interface ConversationPanelProps {
  turns: readonly Turn[];
  handoffs: readonly Handoff[];
}

/**
 * On wide screens, once a call has started, the conversation gets its own panel beside the phone:
 * the transcript with every hand-off to the specialist open, so the audience can follow what the
 * specialist searched, which handbook pages it used and what it told the assistant. It keeps the
 * last call until a new one starts.
 */
export function ConversationPanel({ turns, handoffs }: ConversationPanelProps) {
  return (
    <div className="relative flex min-h-0 animate-in flex-col overflow-hidden rounded-[2rem] bg-screen/80 shadow-[0_50px_100px_-30px_rgb(0_0_0/0.9)] ring-1 ring-white/[0.08] backdrop-blur-xl duration-300 ease-enter fade-in-0 slide-in-from-right-4">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 size-80 rounded-full bg-lime-400/[0.07] blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(125deg,rgb(255_255_255/0.04)_0%,transparent_30%)]" />
      </div>
      <header className="relative flex items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Conversation</h2>
        {handoffs.length > 0 && (
          <span className="shrink-0 rounded-full bg-white/[0.05] px-2.5 py-1 text-[11.5px] text-white/60 tabular-nums ring-1 ring-white/[0.08]">
            {handoffs.length} {handoffs.length === 1 ? "hand-off" : "hand-offs"}
          </span>
        )}
      </header>
      <Conversation turns={turns} handoffs={handoffs} variant="panel" />
    </div>
  );
}
