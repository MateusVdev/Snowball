import { describe, expect, it } from "vitest";
import {
  LOGIN_RATE_LIMIT,
  isLoginRateLimited,
  rateLimitWindowStart,
} from "@/server/auth/rate-limit";

describe("limitação de tentativas de login", () => {
  it("bloqueia ao atingir o limite por e-mail (todos os IPs)", () => {
    const max = LOGIN_RATE_LIMIT.maxFailuresPerEmail;
    expect(isLoginRateLimited({ byEmail: max - 1, byIp: 0, byEmailAndIp: 0 })).toBe(false);
    expect(isLoginRateLimited({ byEmail: max, byIp: 0, byEmailAndIp: 0 })).toBe(true);
  });

  it("bloqueia ao atingir o limite por IP", () => {
    const max = LOGIN_RATE_LIMIT.maxFailuresPerIp;
    expect(isLoginRateLimited({ byEmail: 0, byIp: max - 1, byEmailAndIp: 0 })).toBe(false);
    expect(isLoginRateLimited({ byEmail: 0, byIp: max, byEmailAndIp: 0 })).toBe(true);
  });

  it("calcula o início da janela", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(rateLimitWindowStart(now).toISOString()).toBe(
      "2026-01-01T11:45:00.000Z",
    );
  });
});
