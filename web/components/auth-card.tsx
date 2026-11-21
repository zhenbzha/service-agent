import { Backdrop } from "@/components/backdrop";

/** The one card that every screen outside a call sits on: sign-in and setup. */
export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <Backdrop variant="auth" />
      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-12">
        <div className="relative w-full max-w-[24rem]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-8 left-1/2 h-12 w-[78%] -translate-x-1/2 rounded-[50%] bg-lime-300/15 blur-2xl"
          />
          <div className="relative overflow-hidden rounded-[2rem] bg-screen p-7 shadow-[0_50px_100px_-30px_rgb(0_0_0/0.9),0_0_90px_-25px_oklch(0.897_0.196_126.7/0.25)] ring-1 ring-white/10 sm:p-8">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-28 left-1/2 size-72 -translate-x-1/2 rounded-full bg-lime-400/[0.14] blur-3xl"
            />
            <div className="relative">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
