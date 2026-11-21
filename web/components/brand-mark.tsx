import { cn } from "@/lib/utils";

/** The Zava Energy mark: a monogram "Z" on the lime accent, the same as app/icon.svg. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7 shrink-0", className)}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M10.5 10.75h11l-11 10.5h11"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
