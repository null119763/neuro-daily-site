import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 900 }, locale: "ru-RU" },
  webServer: {
    // Requires a production build (npm run build). Uses a fresh JSON data file and only the mock provider.
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      AUDEN_BACKEND: "local",
      AUDEN_LOCAL_DATA_FILE: `.data/e2e-${Date.now()}.json`,
      OPENROUTER_API_KEY: "",
      AUDEN_USER_PER_MINUTE: "100",
      AUDEN_USER_DAILY_MESSAGES: "500",
      AUDEN_GLOBAL_DAILY_REQUESTS: "5000",
      AUDEN_SIGNUPS_PER_IP_HOUR: "1000",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
