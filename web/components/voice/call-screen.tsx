import type { TokenCredential } from "@azure/core-auth";
import { useState } from "react";

import { Backdrop } from "@/components/backdrop";
import { type Account, AppHeader } from "@/components/voice/app-header";
import { CallCard } from "@/components/voice/call-card";
import { ConversationPanel } from "@/components/voice/conversation-panel";
import { useLiveCall } from "@/hooks/use-live-call";
import { useMediaQuery } from "@/hooks/use-media-query";
import { visibleHandoffs } from "@/lib/live/state";

/** Tailwind's `lg`, so the layout chosen here and the card's `lg:` styles switch together. */
const WIDE = "(min-width: 64rem)";

interface CallScreenProps {
  endpoint: string;
  agentName: string;
  credential: TokenCredential;
  account: Account;
  onSignOut: () => void;
}

/**
 * The signed-in page, on the green halftone backdrop. Before a call it is one card, centred on
 * large screens and filling the screen on phones. Once a call starts on a large screen, the card
 * moves left and the conversation, with the specialist's hand-offs, opens in a panel beside it.
 */
export function CallScreen({ endpoint, agentName, credential, account, onSignOut }: CallScreenProps) {
  const call = useLiveCall({ endpoint, agentName, credential });
  // Here rather than in the header, so the card's "Demo accounts" button opens the same popover.
  const [demoOpen, setDemoOpen] = useState(false);
  const wide = useMediaQuery(WIDE);
  const split = wide && call.state.startedAt !== undefined;

  return (
    <div className="relative isolate flex min-h-dvh flex-col max-lg:h-dvh">
      <Backdrop variant="app" />
      <AppHeader account={account} onSignOut={onSignOut} demoOpen={demoOpen} onDemoOpenChange={setDemoOpen} />
      <main className="relative z-10 flex min-h-0 flex-1 flex-col lg:items-center lg:justify-center lg:pb-10 short:pb-6">
        <h1 className="sr-only">Zava Energy customer service</h1>
        {/* One wrapper either way, so the card stays mounted when the panel opens or the window resizes. */}
        <div
          className={
            split
              ? "mx-auto grid h-[min(46rem,calc(100dvh-6.5rem))] w-full max-w-6xl grid-cols-[28rem_minmax(0,1fr)] gap-8 px-8"
              : "contents"
          }
        >
          <CallCard
            call={call}
            layout={split ? "call" : "transcript"}
            onShowDemoCustomers={() => setDemoOpen(true)}
          />
          {split && <ConversationPanel turns={call.state.turns} handoffs={visibleHandoffs(call.state.handoffs)} />}
        </div>
      </main>
    </div>
  );
}
