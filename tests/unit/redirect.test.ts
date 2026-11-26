import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/server/auth/redirect";

describe("safeRedirectPath (proteção contra open redirect)", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/carteira?aba=1", "/carteira?aba=1"],
    ["/renda-fixa/abc#movimentos", "/renda-fixa/abc#movimentos"],
    ["/a/../metas", "/metas"], // devolve a forma normalizada
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"], // barras codificadas continuam no mesmo site
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
    // Auditoria de segurança: o navegador remove TAB/CR/LF e trata "\" como "/"
    "/\t/evil.example",
    "\t//evil.example",
    "/\r/evil.example",
    "/\u0000/evil.example",
    "/\u007F/evil.example",
    "/\\evil.example",
    "\\/evil.example",
    "/a/..//evil.example", // normaliza para //evil.example
    "/./%2e%2e//evil.example",
    "/login",
    "/login/",
    "/x/../login?next=/y",
    `/${"a".repeat(3000)}`,
  ])("rejeita %s", (input) => {
    expect(safeRedirectPath(input)).toBe("/dashboard");
  });
});

describe("safeRedirectPath segue o parser de URL dos navegadores (WHATWG)", () => {
  it.each(["/\t/evil.example", "/\n/evil.example", "/\\evil.example"])(
    "%s resolveria para outro site, então é recusado",
    (input) => {
      expect(new URL(input, "https://bola-de-neve.example").origin).not.toBe("https://bola-de-neve.example");
      expect(safeRedirectPath(input)).toBe("/dashboard");
    },
  );

  it("/a/..//evil.example normaliza para //evil.example (endereço de outro site se usado como destino)", () => {
    const normalized = new URL("/a/..//evil.example", "https://bola-de-neve.example").pathname;
    expect(normalized).toBe("//evil.example");
    expect(new URL(normalized, "https://bola-de-neve.example").origin).toBe("https://evil.example");
    expect(safeRedirectPath("/a/..//evil.example")).toBe("/dashboard");
  });
});
