import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("hash de senha (scrypt)", () => {
  it("não armazena a senha em texto puro e usa o formato esperado", async () => {
    const hash = await hashPassword("SenhaForte123");
    expect(hash).not.toContain("SenhaForte123");
    expect(hash.split("$")).toHaveLength(6);
    expect(hash.startsWith("scrypt$32768$8$1$")).toBe(true);
  });

  it("gera salts diferentes para a mesma senha", async () => {
    const [a, b] = await Promise.all([
      hashPassword("SenhaForte123"),
      hashPassword("SenhaForte123"),
    ]);
    expect(a).not.toEqual(b);
  });

  it("verifica senha correta e rejeita incorreta", async () => {
    const hash = await hashPassword("SenhaForte123");
    await expect(verifyPassword("SenhaForte123", hash)).resolves.toBe(true);
    await expect(verifyPassword("senhaforte123", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("rejeita hashes malformados ou com parâmetros abusivos", async () => {
    await expect(verifyPassword("x", "texto-puro")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt$1$2$3$4$5")).resolves.toBe(false);
    const hash = await hashPassword("SenhaForte123");
    const abusive = hash.replace("scrypt$32768$", `scrypt$${2 ** 24}$`);
    await expect(verifyPassword("SenhaForte123", abusive)).resolves.toBe(false);
  });
});
