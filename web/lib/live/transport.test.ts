import { expect, it } from "vitest";

import { browserLiveUrl } from "./transport";

it("moves the preview and request-ID headers to the query, and never the bearer token", () => {
  const url = browserLiveUrl("wss://test.services.ai.azure.com/api/projects/test/agents/live?api-version=v1", {
    authorization: "Bearer secret-token",
    "Foundry-Features": "VoiceAgents=V1Preview",
    "x-ms-client-request-id": "request-1",
  });
  const query = new URL(url).searchParams;
  expect(Object.fromEntries(query)).toEqual({
    "api-version": "v1",
    foundry_features: "VoiceAgents=V1Preview",
    "client-request-id": "request-1",
  });
  expect(url).not.toContain("secret-token");
});
