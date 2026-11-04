import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  // app.spec.ts creates the administrator first; the scan specs follow
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "./e2e/.results",
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome", locale: "ar-EG", viewport: { width: 1360, height: 860 } },
  webServer: [
    { command: "node e2e/mock-odoo.mjs", port: 8070, reuseExistingServer: false },
    {
      command: `rm -rf .e2e-data && npx next start -p ${PORT}`,
      port: PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ODOO_URL: "http://localhost:8070",
        ODOO_API_KEY: "test-key",
        SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-123456",
        DATA_DIR: "./.e2e-data",
      },
    },
  ],
});
