import { defineConfig } from "@playwright/test";

const port = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${port}`, channel: "chrome" },
  webServer: {
    command: `npx next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DESIGN_SYSTEM_ENABLED: "true" },
  },
});
