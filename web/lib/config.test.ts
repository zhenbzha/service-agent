import { expect, it } from "vitest";

import { readConfig } from "./config";

it("trims the settings and names each missing or blank variable", () => {
  expect(
    readConfig({
      FOUNDRY_PROJECT_ENDPOINT: " https://test.services.ai.azure.com/api/projects/test ",
      VOICE_AGENT_NAME: "voice-agent",
      ENTRA_WEB_CLIENT_ID: "  ",
    }),
  ).toEqual({ missing: ["ENTRA_WEB_CLIENT_ID", "AZURE_TENANT_ID"] });
  expect(
    readConfig({
      FOUNDRY_PROJECT_ENDPOINT: " https://test.services.ai.azure.com/api/projects/test ",
      VOICE_AGENT_NAME: "voice-agent",
      ENTRA_WEB_CLIENT_ID: "client-id",
      AZURE_TENANT_ID: "tenant-id\n",
    }),
  ).toEqual({
    config: {
      endpoint: "https://test.services.ai.azure.com/api/projects/test",
      agentName: "voice-agent",
      clientId: "client-id",
      tenantId: "tenant-id",
    },
  });
});
