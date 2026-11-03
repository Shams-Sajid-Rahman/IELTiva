// Builds the web app pointing at the API instance used by the browser tests.
import { spawnSync } from "node:child_process";

const result = spawnSync("npx next build", {
  shell: true,
  stdio: "inherit",
  env: { ...process.env, DESIGN_SYSTEM_ENABLED: "true", NEXT_PUBLIC_API_URL: "http://localhost:5100/api/v1", NEXT_PUBLIC_SITE_URL: "http://localhost:3100" },
});
process.exit(result.status ?? 1);
