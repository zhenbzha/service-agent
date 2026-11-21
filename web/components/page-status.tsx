import { LoaderCircleIcon } from "lucide-react";

import { Backdrop } from "@/components/backdrop";

/** A full page with a spinner and one short status line, for the moments between screens. */
export function PageStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <Backdrop variant="auth" />
      <main className="relative z-10 flex flex-1 items-center justify-center px-6">
        <p
          role="status"
          className="flex items-center gap-2.5 rounded-full bg-white/[0.04] px-4 py-2 text-[13px] text-white/60 ring-1 ring-white/[0.08]"
        >
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin text-lime-300 motion-reduce:animate-none" />
          {children}
        </p>
      </main>
    </div>
  );
}
