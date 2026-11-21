// Returns the containers of an existing container app so that `azd provision` keeps the image
// that `azd deploy` pushed. Same as the azd scaffold template
// (Azure/azure-dev cli/azd/resources/scaffold/base/modules/fetch-container-image.bicep),
// on the stable API version that AVM container-app 0.23.1 uses.

@description('Whether the container app exists. When false, the module returns no containers.')
param exists bool

@description('Name of the container app.')
param name string

resource existingApp 'Microsoft.App/containerApps@2026-01-01' existing = if (exists) {
  name: name
}

output containers array = exists ? existingApp!.properties.template.containers : []
