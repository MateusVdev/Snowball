import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Testes unitários: rápidos, sem banco nem rede. */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // "server-only" lança erro fora do bundler do Next; nos testes é neutro.
      "server-only": fileURLToPath(
        new URL("./tests/support/empty.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
