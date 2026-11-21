"use client";

import { useEffect } from "react";

import { AuthCard } from "@/components/auth-card";
import { BrandMark } from "@/components/brand-mark";

/** Replaces the page when rendering throws, instead of Next.js's blank client-exception page. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);

  return (
    <AuthCard>
      <div className="flex flex-col items-center text-center">
        <BrandMark className="size-10" />
        <h1 className="mt-6 text-[1.5rem] leading-tight font-semibold tracking-tight">Something went wrong</h1>
        {error instanceof Error && error.message && (
          <p className="mt-3 font-mono text-[11px] leading-relaxed break-words text-white/50">{error.message}</p>
        )}
        <button
          type="button"
          onClick={retry}
          className="mt-7 flex h-11 w-full items-center justify-center rounded-full bg-lime-300 text-[14px] font-semibold text-ink transition hover:bg-lime-200 active:scale-[0.98]"
        >
          Try again
        </button>
      </div>
    </AuthCard>
  );
}
