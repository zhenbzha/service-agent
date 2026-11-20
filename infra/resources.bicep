import { modelType } from 'types.bicep'

@description('Region for all resources.')
param location string

@description('Tags applied to all resources.')
param tags object

@description('Unique suffix for globally unique resource names.')
param resourceToken string

@description('Object ID of the developer or app that builds and runs agents.')
param principalId string

@description('Principal type of principalId.')
param principalType string

@description('Name of the Foundry project.')
param projectName string

@description('GPT-Live capacity in concurrent sessions.')
param gptLiveCapacity int

@description('Responses-capable model that runs the billing specialist prompt agent.')
param responsesModel modelType

@description('Embedding model used by the Foundry IQ knowledge base.')
param embeddingModel modelType

@description('Deploy Azure AI Search for the knowledge base.')
param deploySearch bool

var foundryAccountName = 'aif-${resourceToken}'
var searchServiceName = 'srch-${resourceToken}'

var roleIds = {
  foundryUser: '53ca6127-db72-4b80-b1b0-d745d6d5456d'
  cognitiveServicesUser: 'a97b65f3-24c7-4388-baec-2e87135dc908'
  logAnalyticsReader: '73c42c96-874c-492b-b04d-ab87d138a893'
  searchIndexDataContributor: '8ebe5a00-799e-43f5-93ac-243d3dce84a7'
  searchIndexDataReader: '1407120a-92aa-4202-b7e9-c0e197c71c8f'
  searchServiceContributor: '7ca78c08-252a-4471-8644-bb5ff32d4ba0'
}

var gptLiveDeploymentName = 'gpt-live-1'

module logAnalytics 'br/public:avm/res/operational-insights/workspace:0.16.2' = {
  name: 'log-${resourceToken}'
  params: {
    name: 'log-${resourceToken}'
    location: location
    tags: tags
    dataRetention: 30
  }
}

module appInsights 'br/public:avm/res/insights/component:0.8.0' = {
  name: 'appi-${resourceToken}'
  params: {
    name: 'appi-${resourceToken}'
    location: location
    tags: tags
    workspaceResourceId: logAnalytics.outputs.resourceId
    // Viewing agent traces needs Log Analytics Reader for the developer; trace evaluations need it for the project identity.
    roleAssignments: [
      {
        principalId: principalId
        principalType: principalType
        roleDefinitionIdOrName: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.logAnalyticsReader)
      }
      {
        principalId: project.identity.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.logAnalyticsReader)
      }
    ]
  }
}

module foundry 'br/public:avm/res/cognitive-services/account:0.19.2' = {
  name: foundryAccountName
  params: {
    name: foundryAccountName
    kind: 'AIServices'
    sku: 'S0'
    location: location
    tags: tags
    customSubDomainName: foundryAccountName
    allowProjectManagement: true
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
    }
    managedIdentities: {
      systemAssigned: true
    }
    deployments: [
      {
        name: gptLiveDeploymentName
        model: {
          format: 'OpenAI'
          name: 'gpt-live-1'
          version: '2026-09-10'
        }
        sku: {
          name: 'GlobalStandard'
          capacity: gptLiveCapacity
        }
      }
      {
        name: responsesModel.name
        model: {
          format: 'OpenAI'
          name: responsesModel.name
          version: responsesModel.version
        }
        sku: {
          name: responsesModel.skuName
          capacity: responsesModel.capacity
        }
      }
      {
        name: embeddingModel.name
        model: {
          format: 'OpenAI'
          name: embeddingModel.name
          version: embeddingModel.version
        }
        sku: {
          name: embeddingModel.skuName
          capacity: embeddingModel.capacity
        }
      }
    ]
    diagnosticSettings: [
      {
        workspaceResourceId: logAnalytics.outputs.resourceId
      }
    ]
  }
}

// AVM has no module for Foundry projects or project connections, so these use native resources
// that follow Azure-Samples/azd-ai-starter-basic. The explicit dependency delays reading the
// existing account until the AVM module has created it.
resource foundryAccount 'Microsoft.CognitiveServices/accounts@2026-09-01' existing = {
  name: foundryAccountName
  dependsOn: [
    foundry
  ]
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2026-09-01' = {
  parent: foundryAccount
  name: projectName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: 'Voice service agent'
    description: 'GPT-Live voice agent for a consumer energy customer-service demo.'
  }
}

resource appInsightsConnection 'Microsoft.CognitiveServices/accounts/projects/connections@2026-09-01' = {
  parent: project
  name: 'appi-${resourceToken}'
  properties: {
    category: 'AppInsights'
    target: appInsights.outputs.resourceId
    authType: 'ApiKey'
    isSharedToAll: true
    credentials: {
      key: appInsights.outputs.connectionString
    }
    metadata: {
      ApiType: 'Azure'
      ResourceId: appInsights.outputs.resourceId
    }
  }
}

module developerFoundryUser 'br/public:avm/ptn/authorization/resource-role-assignment:0.1.2' = {
  name: 'ra-dev-foundry-user-${resourceToken}'
  params: {
    principalId: principalId
    principalType: principalType
    resourceId: project.id
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.foundryUser)
  }
}

module search 'br/public:avm/res/search/search-service:0.13.1' = if (deploySearch) {
  name: searchServiceName
  params: {
    name: searchServiceName
    location: location
    tags: tags
    sku: 'basic'
    replicaCount: 1
    partitionCount: 1
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    semanticSearch: 'free'
    managedIdentities: {
      systemAssigned: true
    }
    diagnosticSettings: [
      {
        workspaceResourceId: logAnalytics.outputs.resourceId
      }
    ]
    roleAssignments: [
      {
        principalId: principalId
        principalType: principalType
        roleDefinitionIdOrName: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.searchIndexDataContributor)
      }
      {
        principalId: principalId
        principalType: principalType
        roleDefinitionIdOrName: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.searchServiceContributor)
      }
      {
        // Agents query the Foundry IQ knowledge base with the project identity, which only needs read access.
        principalId: project.identity.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.searchIndexDataReader)
      }
    ]
  }
}

// Lets the search service call Foundry models for vectorization, query planning and answer synthesis.
module searchCognitiveServicesUser 'br/public:avm/ptn/authorization/resource-role-assignment:0.1.2' = if (deploySearch) {
  name: 'ra-search-cs-user-${resourceToken}'
  params: {
    // The search module enables a system-assigned identity above, so the principal ID is always set.
    principalId: search!.outputs.systemAssignedMIPrincipalId!
    principalType: 'ServicePrincipal'
    resourceId: foundry.outputs.resourceId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.cognitiveServicesUser)
  }
}

resource searchConnection 'Microsoft.CognitiveServices/accounts/projects/connections@2026-09-01' = if (deploySearch) {
  parent: project
  name: searchServiceName
  properties: {
    category: 'CognitiveSearch'
    target: search!.outputs.endpoint
    authType: 'AAD'
    isSharedToAll: true
    metadata: {
      ApiType: 'Azure'
      ResourceId: search!.outputs.resourceId
      type: 'azure_ai_search'
    }
  }
}

output foundryAccountName string = foundry.outputs.name
output projectName string = project.name
output projectEndpoint string = project.properties.endpoints['AI Foundry API']
output openAiEndpoint string = foundryAccount.properties.endpoints['OpenAI Language Model Instance API']
output gptLiveDeploymentName string = gptLiveDeploymentName
output responsesDeploymentName string = responsesModel.name
output embeddingDeploymentName string = embeddingModel.name
output searchEndpoint string = deploySearch ? search!.outputs.endpoint : ''
output searchConnectionName string = deploySearch ? searchConnection.name : ''
output appInsightsConnectionString string = appInsights.outputs.connectionString
