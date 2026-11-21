import type { AccessToken, TokenCredential } from "@azure/core-auth";
import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type IPublicClientApplication,
} from "@azure/msal-browser";

/**
 * A TokenCredential over MSAL for the signed-in user, as in the Azure SDK guidance
 * "Authenticating with the @azure/msal-browser Public Client"
 * (Azure/azure-sdk-for-js sdk/identity/identity/samples/AzureIdentityExamples.md).
 */
export class MsalCredential implements TokenCredential {
  constructor(
    private readonly msal: IPublicClientApplication,
    private readonly account: AccountInfo,
  ) {}

  async getToken(scopes: string | string[]): Promise<AccessToken> {
    const request = { account: this.account, scopes: Array.isArray(scopes) ? scopes : [scopes] };
    try {
      const result = await this.msal.acquireTokenSilent(request);
      if (!result.expiresOn) throw new Error("MSAL returned an access token without an expiry time.");
      return { token: result.accessToken, expiresOnTimestamp: result.expiresOn.getTime() };
    } catch (error) {
      // Consent or a new sign-in is needed: the page navigates to Microsoft Entra and back.
      if (error instanceof InteractionRequiredAuthError) await this.msal.acquireTokenRedirect(request);
      throw error;
    }
  }
}
