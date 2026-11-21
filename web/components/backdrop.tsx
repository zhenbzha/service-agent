import { cn } from "@/lib/utils";

/**
 * The page behind every screen: deep green, emerald light from below, halftone dot fields and two
 * thin lime rings around the card. It is decoration only.
 *
 * The app variant centres the rings on the call card, below the 4rem header, and hides the
 * bottom-left halftone on phones, where it would sit under the transcript.
 */
export function Backdrop({ variant }: { variant: "app" | "auth" }) {
  const app = variant === "app";
  const ringTop = app ? "top-[calc(50%+2rem)]" : "top-1/2";

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_118%,oklch(0.42_0.1_160/0.55),transparent_70%),radial-gradient(45%_35%_at_88%_0%,oklch(0.696_0.17_162.5/0.13),transparent_70%)]" />
      <div className="absolute inset-x-0 top-0 h-96 bg-[radial-gradient(70%_60%_at_50%_0%,oklch(0.841_0.238_128.85/0.1),transparent_70%)] lg:hidden" />
      {/* The bottom-left field. */}
      <div
        className={cn(
          "absolute inset-0 halftone-fine [mask-image:radial-gradient(85%_75%_at_0%_100%,#000_0%,rgb(0_0_0/.5)_35%,transparent_72%)]",
          app && "max-lg:hidden",
        )}
      />
      <div
        className={cn(
          "absolute inset-0 halftone-bold [mask-image:radial-gradient(55%_45%_at_0%_100%,#000_0%,transparent_70%)]",
          app && "max-lg:hidden",
        )}
      />
      {/* The right-hand field, on large screens only. */}
      <div className="absolute inset-0 halftone-fine [mask-image:radial-gradient(45%_60%_at_100%_70%,#000_0%,rgb(0_0_0/.4)_40%,transparent_75%)] max-lg:hidden" />
      <div className="absolute inset-0 halftone-bold [mask-image:radial-gradient(28%_38%_at_100%_78%,#000_0%,transparent_70%)] max-lg:hidden" />
      <div className={cn("absolute left-1/2 size-[42rem] -translate-1/2 rounded-full border border-lime-300/20 max-lg:hidden", ringTop)} />
      <div className={cn("absolute left-1/2 size-[64rem] -translate-1/2 rounded-full border border-lime-300/[0.08] max-lg:hidden", ringTop)} />
    </div>
  );
}
