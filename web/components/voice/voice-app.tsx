"use client";

import { AuthenticatedTemplate, UnauthenticatedTemplate, useMsal } from "@azure/msal-react";
import dynamic from "next/dynamic";
import { useMemo } from "react";

import { AuthProvider } from "@/components/auth-provider";
import { PageStatus } from "@/components/page-status";
import { SignIn } from "@/components/voice/sign-in";
import { MsalCredential } from "@/lib/auth/credential";
import type { AppConfig } from "@/lib/config";

// The call needs the browser (microphone, audio, WebSocket) and the Foundry SDK, so it is loaded
// only in the browser, after sign-in. This keeps the SDK out of the server build and the sign-in page.
const CallScreen = dynamic(() => import("@/components/voice/call-screen").then((module) => module.CallScreen), {
  ssr: false,
  loading: () => <PageStatus>Loading…</PageStatus>,
});

/** The voice app: sign in with Microsoft Entra ID, then call the voice agent as that user. */
export function VoiceApp({ config }: { config: AppConfig }) {
  return (
    <AuthProvider clientId={config.clientId} tenantId={config.tenantId}>
      <UnauthenticatedTemplate>
        <SignIn />
      </UnauthenticatedTemplate>
      <AuthenticatedTemplate>
        <SignedInCall endpoint={config.endpoint} agentName={config.agentName} />
      </AuthenticatedTemplate>
    </AuthProvider>
  );
}

function SignedInCall({ endpoint, agentName }: { endpoint: string; agentName: string }) {
  const { instance, accounts } = useMsal();
  // AuthenticatedTemplate renders this only when an account is signed in.
  const account = accounts[0];
  // Calls request Foundry tokens for this account; a new account gets a new credential.
  const credential = useMemo(() => new MsalCredential(instance, account), [instance, account]);

  return (
    <CallScreen
      endpoint={endpoint}
      agentName={agentName}
      credential={credential}
      account={account}
      onSignOut={() => {
        instance.logoutRedirect({ account }).catch((error: unknown) => console.error("Sign-out failed", error));
      }}
    />
  );
}
