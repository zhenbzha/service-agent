import { KeyboardIcon } from "lucide-react";

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { HandoffTrace } from "@/components/voice/handoff-trace";
import { PERSONA } from "@/lib/persona";
import type { Handoff, Turn } from "@/lib/live/state";

type Entry = { kind: "turn"; turn: Turn } | { kind: "handoff"; handoff: Handoff };

/** Turns and hand-offs in the order they happened: each hand-off goes after `afterTurns` turns. */
function timeline(turns: readonly Turn[], handoffs: readonly Handoff[]): Entry[] {
  const entries: Entry[] = [];
  let next = 0;
  turns.forEach((turn, index) => {
    while (next < handoffs.length && handoffs[next].afterTurns <= index) {
      entries.push({ kind: "handoff", handoff: handoffs[next++] });
    }
    entries.push({ kind: "turn", turn });
  });
  for (const handoff of handoffs.slice(next)) entries.push({ kind: "handoff", handoff });
  return entries;
}

/**
 * The live transcript, with the agent's hand-offs to the specialist in between. It fills the
 * space it is given and scrolls inside it; in the phone card the section is there even before the
 * greeting, so the dock doesn't move when the first words arrive.
 *
 * The "card" variant is the phone's transcript, with hand-offs collapsed to a pill. The "panel"
 * variant is the wide panel beside the phone, with every hand-off open.
 */
export function Conversation({
  turns,
  handoffs,
  variant = "card",
}: {
  turns: readonly Turn[];
  handoffs: readonly Handoff[];
  variant?: "card" | "panel";
}) {
  const entries = timeline(turns, handoffs);
  const panel = variant === "panel";

  return (
    <section aria-label="Conversation" className="relative min-h-0 flex-1">
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="absolute inset-0">
          <MessageScrollerViewport>
            <MessageScrollerContent className={panel ? "gap-4 px-6 py-6" : "gap-3.5 px-4 py-5"}>
              {entries.map((entry) =>
                entry.kind === "turn" ? (
                  // A customer turn anchors the view, as a user message does in a chat.
                  <MessageScrollerItem
                    key={entry.turn.id}
                    messageId={entry.turn.id}
                    scrollAnchor={entry.turn.speaker === "customer"}
                  >
                    <TurnMessage turn={entry.turn} wide={panel} />
                  </MessageScrollerItem>
                ) : (
                  <MessageScrollerItem key={entry.handoff.id} messageId={entry.handoff.id}>
                    <HandoffTrace handoff={entry.handoff} defaultOpen={panel} />
                  </MessageScrollerItem>
                ),
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="size-8 rounded-full bg-popover ring-1 ring-white/10" />
        </MessageScroller>
      </MessageScrollerProvider>
    </section>
  );
}

/** The agent speaks in plain text, the customer in a bubble on the right, as in a phone's transcript. */
function TurnMessage({ turn, wide }: { turn: Turn; wide: boolean }) {
  const text = turn.text.trim();
  if (turn.speaker === "agent") {
    return (
      <p className={wide ? "pr-16 text-[15px] leading-[1.65] text-white/90" : "pr-6 text-[14.5px] leading-[1.6] text-white/90"}>
        <span className="sr-only">{PERSONA.name}: </span>
        {text}
      </p>
    );
  }
  return (
    <div className={wide ? "flex justify-end pl-24" : "flex justify-end pl-12"}>
      <p className="rounded-[1.1rem] rounded-br-md bg-white/[0.09] px-3.5 py-2 text-[14px] leading-relaxed text-white/95">
        <span className="sr-only">You{turn.typed ? " (typed)" : ""}: </span>
        {turn.typed && <KeyboardIcon aria-hidden="true" className="mr-1.5 inline size-3.5 -translate-y-px text-white/45" />}
        {text}
      </p>
    </div>
  );
}
