@export()
@description('Model deployment settings.')
type modelType = {
  @description('Model name, also used as the deployment name.')
  name: string

  @description('Model version.')
  version: string

  @description('Deployment type, for example GlobalStandard or DataZoneStandard.')
  skuName: string

  @description('Deployment capacity in thousands of tokens per minute.')
  capacity: int
}
