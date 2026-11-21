extension microsoftGraphV1

// Single-tenant SPA app registration for the web app. The browser signs users in with MSAL and
// gets delegated tokens for Foundry (https://ai.azure.com). Follows the Microsoft Graph Bicep
// quickstart microsoftgraph/msgraph-bicep-types/quickstart-templates/apps-permissions-and-grants:
// the caller looks up the resource service principal and passes the filtered scopes, because
// for-expressions need values that are known when this module starts.

@description('Display name of the app registration.')
param displayName string

@description('Immutable client-provided key of the app registration. Keeps redeployments idempotent.')
param uniqueName string

@description('Object ID of the user or service principal that owns the app registration.')
param ownerId string

@description('SPA redirect URIs for the MSAL authorization code flow with PKCE.')
param redirectUris string[]

@description('Application ID of the resource app that the scopes belong to.')
param resourceAppId string

@description('Object ID of the resource app\'s service principal.')
param resourceSpId string

@description('Delegated permission scopes of the resource app to request and grant.')
param filteredScopes permissionScope[]

type permissionScope = {
  id: string
  value: string
}

var scopeString = join(map(filteredScopes, scope => scope.value), ' ')

resource webApp 'Microsoft.Graph/applications@v1.0' = {
  displayName: displayName
  uniqueName: uniqueName
  signInAudience: 'AzureADMyOrg'
  owners: {
    relationships: [
      ownerId
    ]
  }
  spa: {
    redirectUris: redirectUris
  }
  requiredResourceAccess: [
    {
      resourceAppId: resourceAppId
      resourceAccess: [
        for scope in filteredScopes: {
          id: scope.id
          type: 'Scope'
        }
      ]
    }
  ]
}

resource webSp 'Microsoft.Graph/servicePrincipals@v1.0' = {
  appId: webApp.appId
  owners: {
    relationships: [
      ownerId
    ]
  }
}

// Tenant-wide admin consent, so users aren't asked to consent on first sign-in. The deployer needs
// Cloud Application Administrator or Application Administrator (Learn "Grant tenant-wide admin consent").
resource scopesGrant 'Microsoft.Graph/oauth2PermissionGrants@v1.0' = {
  clientId: webSp.id
  resourceId: resourceSpId
  consentType: 'AllPrincipals'
  scope: scopeString
}

output appId string = webApp.appId
