import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { useState } from "react";

import { msalConfiguration } from "@/lib/auth/msal";

/**
 * Provides MSAL to the call page. MsalProvider initializes the instance and handles the
 * redirect response. The /redirect bridge page must stay outside this provider.
 */
export function AuthProvider({
  clientId,
  tenantId,
  children,
}: {
  clientId: string;
  tenantId: string;
  children: React.ReactNode;
}) {
  const [instance] = useState(() => new PublicClientApplication(msalConfiguration(clientId, tenantId)));
  return <MsalProvider instance={instance}>{children}</MsalProvider>;
}
