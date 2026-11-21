// Hosting for the Next.js web app (web/) on Azure Container Apps, plus its Entra app registration.
// Follows the azd scaffold template (Azure/azure-dev cli/azd/resources/scaffold/templates/resources.bicept)
// on current AVM versions.

extension microsoftGraphV1

@description('Region for all resources.')
param location string

@description('Tags applied to all resources.')
param tags {*: string}

// uniqueString() returns 13 characters. Declaring that length lets Bicep verify that the registry
// name ('cr' + token) meets its 5-character minimum (otherwise warning BCP334).
@minLength(13)
@maxLength(13)
@description('Unique suffix for globally unique resource names.')
param resourceToken string

@description('Name of the azd environment. Shown in the app registration display name.')
param environmentName string

@description('Object ID of the developer or app that provisions the environment. Owns the app registration.')
param principalId string

@description('Whether the web container app already exists. azd sets SERVICE_WEB_RESOURCE_EXISTS.')
param webAppExists bool

@description('Resource ID of the Log Analytics workspace that receives the container app logs.')
param logAnalyticsWorkspaceResourceId string

@description('Foundry project endpoint that the web app calls with the signed-in user\'s token.')
param foundryProjectEndpoint string

var webAppName = 'ca-web-${resourceToken}'
var webAppPort = 3000

var roleIds = {
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
}

// Azure Machine Learning Services is the resource app behind the https://ai.azure.com audience
// that Foundry project endpoints accept.
var azureMachineLearningAppId = '18a66f5f-dbdf-4c17-9dd7-1634712a9cbe'
var foundryScopes = [
  'user_impersonation'
]

// Get the resource service principal so that the scope names can be mapped to permission IDs
resource azureMachineLearningSp 'Microsoft.Graph/servicePrincipals@v1.0' existing = {
  appId: azureMachineLearningAppId
}

var filteredScopes = filter(azureMachineLearningSp.oauth2PermissionScopes, scope => contains(foundryScopes, scope.value))

module webIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.6.0' = {
  name: 'id-web-${resourceToken}'
  params: {
    name: 'id-web-${resourceToken}'
    location: location
    tags: tags
  }
}

// azd builds the image with ACR Tasks (docker.remoteBuild in azure.yaml) and the app pulls it with
// the user-assigned identity, so the admin user and anonymous pull stay off.
module containerRegistry 'br/public:avm/res/container-registry/registry:0.13.2' = {
  name: 'cr${resourceToken}'
  params: {
    name: 'cr${resourceToken}'
    location: location
    tags: tags
    acrSku: 'Basic'
    acrAdminUserEnabled: false
    anonymousPullEnabled: false
    // The module turns ARM-audience registry tokens off by default; the platform default is on.
    // azd's registry login exchanges an ARM-audience token (pkg/azapi/container_registry.go), which it
    // needs when it pushes a locally built image, so keep the platform default.
    azureADAuthenticationAsArmPolicyStatus: 'enabled'
    roleAssignments: [
      {
        principalId: webIdentity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.acrPull)
      }
    ]
  }
}

// Workload profiles is the default environment type on Learn; the Consumption profile keeps
// serverless billing. Zone redundancy needs a virtual network, which this demo doesn't use.
// Logs go through Azure Monitor diagnostic settings (Learn "Migrate to Azure Monitor"): the
// 'log-analytics' destination needs the workspace shared key, which the workspace disables.
module containerAppsEnvironment 'br/public:avm/res/app/managed-environment:0.17.0' = {
  name: 'cae-${resourceToken}'
  params: {
    name: 'cae-${resourceToken}'
    location: location
    tags: tags
    publicNetworkAccess: 'Enabled'
    zoneRedundant: false
    appLogsConfiguration: {
      destination: 'azure-monitor'
    }
    diagnosticSettings: [
      {
        workspaceResourceId: logAnalyticsWorkspaceResourceId
      }
    ]
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

// The redirect URI uses the app's FQDN (<app name>.<environment default domain>), computed from the
// environment instead of read from the app, because the app needs the registration's client ID.
module appRegistration 'app-registration.bicep' = {
  name: 'appreg-web-${resourceToken}'
  params: {
    displayName: 'Zava Energy voice agent (${environmentName})'
    uniqueName: 'voice-agent-web-${resourceToken}'
    ownerId: principalId
    redirectUris: [
      'http://localhost:${webAppPort}/redirect'
      'https://${webAppName}.${containerAppsEnvironment.outputs.defaultDomain}/redirect'
    ]
    resourceAppId: azureMachineLearningAppId
    resourceSpId: azureMachineLearningSp.id
    filteredScopes: filteredScopes
  }
}

module webFetchLatestImage 'modules/fetch-container-image.bicep' = {
  name: 'web-fetch-image-${resourceToken}'
  params: {
    exists: webAppExists
    name: webAppName
  }
}

module webApp 'br/public:avm/res/app/container-app:0.23.1' = {
  name: webAppName
  params: {
    name: webAppName
    location: location
    tags: union(tags, { 'azd-service-name': 'web' })
    environmentResourceId: containerAppsEnvironment.outputs.resourceId
    workloadProfileName: 'Consumption'
    ingressExternal: true
    ingressTargetPort: webAppPort
    // MSAL needs HTTPS redirect URIs, so HTTP requests are redirected to HTTPS.
    ingressAllowInsecure: false
    scaleSettings: {
      minReplicas: 1
      maxReplicas: 3
    }
    managedIdentities: {
      userAssignedResourceIds: [
        webIdentity.outputs.resourceId
      ]
    }
    registries: [
      {
        server: containerRegistry.outputs.loginServer
        identity: webIdentity.outputs.resourceId
      }
    ]
    containers: [
      {
        name: 'main'
        // The placeholder runs until the first `azd deploy`; later provisions keep the deployed image.
        image: webFetchLatestImage.outputs.?containers[?0].?image ?? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
        resources: {
          cpu: json('0.5')
          memory: '1Gi'
        }
        // Learn's default probes (TCP on the ingress port), which only the portal adds. The API caps
        // failureThreshold at 10, below the portal's startup and readiness defaults.
        probes: [
          {
            type: 'Startup'
            tcpSocket: {
              port: webAppPort
            }
            initialDelaySeconds: 1
            periodSeconds: 3
            timeoutSeconds: 3
            failureThreshold: 10
          }
          {
            type: 'Readiness'
            tcpSocket: {
              port: webAppPort
            }
            initialDelaySeconds: 3
            periodSeconds: 5
            timeoutSeconds: 5
            failureThreshold: 10
          }
          {
            type: 'Liveness'
            tcpSocket: {
              port: webAppPort
            }
          }
        ]
        env: [
          {
            name: 'FOUNDRY_PROJECT_ENDPOINT'
            value: foundryProjectEndpoint
          }
          {
            name: 'AZURE_TENANT_ID'
            value: tenant().tenantId
          }
          {
            name: 'ENTRA_WEB_CLIENT_ID'
            value: appRegistration.outputs.appId
          }
          {
            name: 'VOICE_AGENT_NAME'
            value: 'voice-agent'
          }
          {
            name: 'PORT'
            value: string(webAppPort)
          }
        ]
      }
    ]
  }
}

output containerRegistryLoginServer string = containerRegistry.outputs.loginServer
output webUri string = 'https://${webApp.outputs.fqdn}'
output entraWebClientId string = appRegistration.outputs.appId
