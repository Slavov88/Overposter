import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    ...devices["Desktop Chrome"],
    channel: process.env.CI ? undefined : "chrome",
    baseURL: "http://127.0.0.1:4329",
    trace: "on-first-retry",
  },
  webServer: {
    command: "node --import tsx apps/server/src/index.ts",
    url: "http://127.0.0.1:4329/api/health",
    env: { OVERPOSTER_DATA: resolve(".overposter/e2e"), PORT: "4329" },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
