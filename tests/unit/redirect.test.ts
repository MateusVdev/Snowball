import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/server/auth/redirect";

describe("safeRedirectPath (proteção contra open redirect)", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/carteira?aba=1", "/carteira?aba=1"],
  ])("aceita caminho interno %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    42,
    "",
    "dashboard",
    "https://malicioso.com",
    "//malicioso.com",
    "/\\malicioso.com",
    "/login",
    "/login?next=/x",
    "/a\nSet-Cookie: x",
  ])("rejeita %s", (input) => {
    expect(safeRedirectPath(input)).toBe("/dashboard");
  });
});
