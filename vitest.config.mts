import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // The import tests use a Google Maps export from two states, so the home states are set for them.
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 30000, env: { NEXT_PUBLIC_HOME_STATES: "NY,NJ" } },
});
