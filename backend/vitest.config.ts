import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: [fileURLToPath(new URL("./tests/setup.ts", import.meta.url))],
    env: {
      NODE_ENV: "test",
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});