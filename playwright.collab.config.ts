import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/collaboration.e2e.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { ...devices["Desktop Chrome"], channel: process.env.CI ? undefined : "chrome", baseURL: "http://127.0.0.1:4330" },
  webServer: {
    command: "node --import tsx apps/server/src/index.ts",
    url: "http://127.0.0.1:4330/api/health",
    env: { OVERPOSTER_DATA: resolve(".overposter/e2e-collab"), PORT: "4330", OVERPOSTER_MODE: "test-hosted", OVERPOSTER_TEST_IDENTITIES: "1", NODE_ENV: "test" },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
