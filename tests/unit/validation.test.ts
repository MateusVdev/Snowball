import { describe, expect, it } from "vitest";
import { createUserSchema, loginSchema } from "@/validation/auth";

describe("validação de autenticação", () => {
  it("normaliza o e-mail (trim + minúsculas)", () => {
    const result = loginSchema.parse({
      email: "  Voce@Exemplo.COM ",
      password: "x",
    });
    expect(result.email).toBe("voce@exemplo.com");
  });

  it("rejeita e-mail inválido e senha vazia", () => {
    const result = loginSchema.safeParse({ email: "nao-eh-email", password: "" });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["email", "password"]));
  });

  it("rejeita senha excessivamente longa no login", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.com", password: "x".repeat(257) })
        .success,
    ).toBe(false);
  });

  it("aplica a política de senha no cadastro", () => {
    const base = { email: "a@b.com", name: "Ana" };
    const check = (password: string) =>
      createUserSchema.safeParse({ ...base, password }).success;
    expect(check("curta1")).toBe(false);
    expect(check("semnumerosaqui")).toBe(false);
    expect(check("123456789012")).toBe(false);
    expect(check("SenhaForte123")).toBe(true);
  });
});
