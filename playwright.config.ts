import { defineConfig, devices } from "@playwright/test";
import { loadTestEnv } from "./tests/support/load-test-env";

/**
 * Testes E2E contra o BUILD DE PRODUÇÃO (`next start`) usando o banco de teste.
 * Pré-requisito: `npm run build`.
 */
const databaseUrl = loadTestEnv();
// E2E não consulta APIs externas: as integrações são testadas com respostas
// simuladas nos testes unitários/integração; aqui ficam desligadas.
process.env.INTEGRATIONS_ENABLED = "false";
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DATABASE_URL: databaseUrl, NODE_ENV: "production", INTEGRATIONS_ENABLED: "false" },
  },
});
