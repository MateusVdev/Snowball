import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from "@/server/auth/tokens";

describe("tokens de sessão", () => {
  it("gera tokens únicos, bem formados e com 256 bits", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateSessionToken));
    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(isWellFormedSessionToken(token)).toBe(true);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
  });

  it("hash é determinístico e não revela o token", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toEqual(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toContain(token);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejeita tokens malformados", () => {
    expect(isWellFormedSessionToken("")).toBe(false);
    expect(isWellFormedSessionToken("abc")).toBe(false);
    expect(isWellFormedSessionToken(`${"a".repeat(42)}=`)).toBe(false);
  });
});
