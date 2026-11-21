/** What the call page needs to sign the customer in and reach the voice agent. */
export interface AppConfig {
  /** Foundry project endpoint: https://<resource>.services.ai.azure.com/api/projects/<project>. */
  endpoint: string;
  /** Name of the GPT-Live voice agent in that project. */
  agentName: string;
  /** Application (client) ID of the single-page app registration in Microsoft Entra. */
  clientId: string;
  tenantId: string;
}

/** The environment variable behind each setting; infra/web.bicep sets them on the container. */
const VARIABLES = {
  endpoint: "FOUNDRY_PROJECT_ENDPOINT",
  agentName: "VOICE_AGENT_NAME",
  clientId: "ENTRA_WEB_CLIENT_ID",
  tenantId: "AZURE_TENANT_ID",
} as const satisfies Record<keyof AppConfig, string>;

export type ConfigResult = { config: AppConfig } | { missing: string[] };

/**
 * Reads the settings from the environment. Call it at request time (after connection()), so the
 * same container image works in every environment.
 */
export function readConfig(env: Record<string, string | undefined> = process.env): ConfigResult {
  const read = (name: string) => env[name]?.trim() ?? "";
  const config: AppConfig = {
    endpoint: read(VARIABLES.endpoint),
    agentName: read(VARIABLES.agentName),
    clientId: read(VARIABLES.clientId),
    tenantId: read(VARIABLES.tenantId),
  };
  const keys = Object.keys(VARIABLES) as (keyof AppConfig)[];
  const missing = keys.filter((key) => !config[key]).map((key) => VARIABLES[key]);
  return missing.length ? { missing } : { config };
}
