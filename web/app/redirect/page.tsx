"use client";

import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";
import { useEffect } from "react";

import { PageStatus } from "@/components/page-status";

// MSAL v5 redirect bridge (msal-browser docs/redirect-bridge.md, Next.js App Router). Microsoft
// Entra returns here; the bridge hands the response to the page that started sign-in.
export default function Redirect() {
  useEffect(() => {
    broadcastResponseToMainFrame().catch((error: unknown) => {
      console.error("Error broadcasting response to main frame:", error);
    });
  }, []);

  // Entra ID returns here after both sign-in and sign-out, so the words fit either.
  return <PageStatus>Redirecting…</PageStatus>;
}
