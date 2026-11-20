import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnv, resetEnvCache } from "@/server/env";

describe("validação de variáveis de ambiente", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("aplica valores padrão", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
    delete process.env.SESSION_TTL_HOURS;
    resetEnvCache();
    expect(getEnv().SESSION_TTL_HOURS).toBe(168);
  });

  it("rejeita DATABASE_URL que não seja PostgreSQL", () => {
    vi.stubEnv("DATABASE_URL", "mysql://u:p@localhost/db");
    resetEnvCache();
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });

  it("converte SESSION_COOKIE_SECURE para booleano", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
    vi.stubEnv("SESSION_COOKIE_SECURE", "false");
    resetEnvCache();
    expect(getEnv().SESSION_COOKIE_SECURE).toBe(false);
  });
});
