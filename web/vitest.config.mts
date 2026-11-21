import { defineConfig } from "vitest/config";

// The unit tests cover logic only, so they run in Node, Vitest's default environment. Vite
// resolves the tsconfig "@/" paths.
export default defineConfig({
  resolve: { tsconfigPaths: true },
});