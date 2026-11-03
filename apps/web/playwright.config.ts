import { defineConfig } from "@playwright/test";

const port = 3100;
process.loadEnvFile("../../.env");

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${port}`, channel: "chrome" },
  webServer: [
    {
      // The real API on its own port, using only the isolated test database.
      command: "node ../api/dist/server.js",
      url: "http://localhost:5100/api/v1/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        PORT: "5100",
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
        FRONTEND_URL: `http://localhost:${port}`,
        API_BASE_URL: "http://localhost:5100",
        LOG_LEVEL: "silent",
      },
    },
    {
      command: `npx next start -p ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DESIGN_SYSTEM_ENABLED: "true" },
    },
  ],
});
