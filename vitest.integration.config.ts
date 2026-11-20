import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";

/**
 * Testes de integração: usam um PostgreSQL real definido em `.env.test`
 * (banco separado do de desenvolvimento). As migrações são aplicadas no
 * globalSetup e as tabelas são limpas antes de cada teste.
 */
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/support/integration-global-setup.ts"],
    setupFiles: ["tests/support/load-test-env.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
