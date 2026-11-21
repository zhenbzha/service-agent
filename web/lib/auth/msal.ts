import type { Configuration } from "@azure/msal-browser";

/** Microsoft Foundry's token scope; the SDK's VoiceAgentLiveClient requests the same. */
export const FOUNDRY_SCOPE = "https://ai.azure.com/.default";

/**
 * MSAL configuration for the single-page app registration. Both redirect URIs point at the
 * MSAL v5 redirect bridge page (app/redirect/page.tsx).
 */
export function msalConfiguration(clientId: string, tenantId: string): Configuration {
  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: "/redirect",
      postLogoutRedirectUri: "/redirect",
    },
  };
}
