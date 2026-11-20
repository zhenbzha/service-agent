targetScope = 'subscription'

import { modelType } from 'types.bicep'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment. Used to derive resource names and the azd-env-name tag.')
param environmentName string

@minLength(1)
@description('Region for all resources. GPT-Live, Agent Service and voice agents (preview) are available in France Central.')
@metadata({
  azd: {
    type: 'location'
    usageName: [
      'OpenAI.GlobalStandard.gpt-live-1,5'
      'OpenAI.DataZoneStandard.gpt-5.5,100'
      'OpenAI.DataZoneStandard.text-embedding-3-large,100'
    ]
  }
})
param location string

@description('Object ID of the developer or app that builds and runs agents.')
param principalId string

@description('Principal type of principalId. Use ServicePrincipal when a pipeline identity provisions the environment.')
@allowed([
  'User'
  'ServicePrincipal'
])
param principalType string = 'User'

@description('Name of the Foundry project.')
param projectName string = 'voice-service-agent'

@description('GPT-Live capacity. The unit is concurrent sessions; the default subscription tier allows 10.')
@minValue(1)
param gptLiveCapacity int = 5

@description('Responses-capable model that runs the billing specialist prompt agent. Use a model listed in the Agent Service model support table on Learn.')
param responsesModel modelType = {
  name: 'gpt-5.5'
  version: '2026-04-24'
  skuName: 'DataZoneStandard'
  capacity: 100
}

@description('Embedding model used by the Foundry IQ knowledge base on Azure AI Search.')
param embeddingModel modelType = {
  name: 'text-embedding-3-large'
  version: '1'
  skuName: 'DataZoneStandard'
  capacity: 100
}

@description('Deploy Azure AI Search for the knowledge base. The billing specialist needs it for the handbook. Basic tier has a fixed monthly cost.')
param deploySearch bool = true

var tags = {
  'azd-env-name': environmentName
  workload: 'voice-service-agent'
}
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var resourceGroupName = 'rg-${environmentName}'

module resourceGroup 'br/public:avm/res/resources/resource-group:0.4.4' = {
  name: 'rg-${resourceToken}'
  params: {
    name: resourceGroupName
    location: location
    tags: tags
  }
}

module resources 'resources.bicep' = {
  name: 'resources-${resourceToken}'
  scope: az.resourceGroup(resourceGroupName)
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
    principalId: principalId
    principalType: principalType
    projectName: projectName
    gptLiveCapacity: gptLiveCapacity
    responsesModel: responsesModel
    embeddingModel: embeddingModel
    deploySearch: deploySearch
  }
  dependsOn: [
    resourceGroup
  ]
}

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_RESOURCE_GROUP string = resourceGroup.outputs.name
output FOUNDRY_ACCOUNT_NAME string = resources.outputs.foundryAccountName
output FOUNDRY_PROJECT_NAME string = resources.outputs.projectName
output FOUNDRY_PROJECT_ENDPOINT string = resources.outputs.projectEndpoint
output AZURE_OPENAI_ENDPOINT string = resources.outputs.openAiEndpoint
output GPT_LIVE_DEPLOYMENT string = resources.outputs.gptLiveDeploymentName
output RESPONSES_DEPLOYMENT string = resources.outputs.responsesDeploymentName
output EMBEDDING_DEPLOYMENT string = resources.outputs.embeddingDeploymentName
output AZURE_SEARCH_ENDPOINT string = resources.outputs.searchEndpoint
output AZURE_SEARCH_CONNECTION_NAME string = resources.outputs.searchConnectionName
output KNOWLEDGE_BASE_NAME string = resources.outputs.knowledgeBaseName
output KNOWLEDGE_BASE_CONNECTION_NAME string = resources.outputs.knowledgeBaseConnectionName
output KNOWLEDGE_BASE_MCP_ENDPOINT string = resources.outputs.knowledgeBaseMcpEndpoint
output APPLICATIONINSIGHTS_CONNECTION_STRING string = resources.outputs.appInsightsConnectionString
