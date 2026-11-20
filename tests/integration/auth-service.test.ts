import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  changePassword,
  createUser,
  login,
  purgeExpiredAuthData,
  revokeSession,
  validateSessionToken,
} from "@/server/auth/service";
import { hashSessionToken } from "@/server/auth/tokens";
import { LOGIN_RATE_LIMIT } from "@/server/auth/rate-limit";
import { createTestDb, resetDatabase } from "../support/db";

const db = createTestDb();
const PASSWORD = "SenhaForte123";
const opts = { ttlHours: 24, meta: { ipAddress: "10.0.0.1", userAgent: "vitest" } };

beforeEach(async () => {
  await resetDatabase(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("conexão com o PostgreSQL", () => {
  it("responde a consultas e tem as tabelas migradas", async () => {
    const rows = await db.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    expect(rows[0].ok).toBe(1);
    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    expect(tables.map((t) => t.table_name)).toEqual(
      expect.arrayContaining(["users", "sessions", "login_attempts"]),
    );
  });
});

describe("serviço de autenticação", () => {
  it("cria usuário com senha em hash e e-mail normalizado", async () => {
    const user = await createUser(db, {
      email: " Investidor@Exemplo.com ",
      name: "Investidor",
      password: PASSWORD,
    });
    expect(user.email).toBe("investidor@exemplo.com");
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(stored.passwordHash.startsWith("scrypt$")).toBe(true);
    // O objeto público não expõe o hash.
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("faz login com credenciais válidas e guarda apenas o hash do token", async () => {
    await createUser(db, { email: "a@b.com", name: "A", password: PASSWORD });
    const result = await login(db, { email: "A@B.com", password: PASSWORD }, opts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sessions = await db.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).toBe(hashSessionToken(result.token));
    expect(sessions[0].tokenHash).not.toBe(result.token);
    expect(sessions[0].ipAddress).toBe("10.0.0.1");

    const user = await validateSessionToken(db, result.token);
    expect(user).toEqual({ id: result.user.id, email: "a@b.com", name: "A" });
  });

  it("rejeita senha errada e e-mail inexistente com a mesma resposta", async () => {
    await createUser(db, { email: "a@b.com", name: "A", password: PASSWORD });
    const wrong = await login(db, { email: "a@b.com", password: "errada" }, opts);
    const missing = await login(db, { email: "x@b.com", password: PASSWORD }, opts);
    expect(wrong).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(missing).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await db.session.count()).toBe(0);
    expect(await db.loginAttempt.count({ where: { success: false } })).toBe(2);
  });

  it("bloqueia após muitas falhas, mesmo com a senha correta", async () => {
    await createUser(db, { email: "a@b.com", name: "A", password: PASSWORD });
    for (let i = 0; i < LOGIN_RATE_LIMIT.maxFailuresPerEmail; i++) {
      await login(db, { email: "a@b.com", password: "errada" }, opts);
    }
    const blocked = await login(db, { email: "a@b.com", password: PASSWORD }, opts);
    expect(blocked).toEqual({ ok: false, reason: "rate_limited" });

    // Após a janela, volta a permitir.
    const later = new Date(Date.now() + LOGIN_RATE_LIMIT.windowMs + 1000);
    const allowed = await login(
      db,
      { email: "a@b.com", password: PASSWORD },
      { ...opts, now: later },
    );
    expect(allowed.ok).toBe(true);
  });

  it("invalida sessão expirada e a remove do banco", async () => {
    await createUser(db, { email: "a@b.com", name: "A", password: PASSWORD });
    const result = await login(db, { email: "a@b.com", password: PASSWORD }, opts);
    if (!result.ok) throw new Error("login falhou");
    const afterExpiry = new Date(result.expiresAt.getTime() + 1);
    expect(await validateSessionToken(db, result.token, afterExpiry)).toBeNull();
    expect(await db.session.count()).toBe(0);
  });

  it("logout revoga a sessão", async () => {
    await createUser(db, { email: "a@b.com", name: "A", password: PASSWORD });
    const result = await login(db, { email: "a@b.com", password: PASSWORD }, opts);
    if (!result.ok) throw new Error("login falhou");
    await revokeSession(db, result.token);
    expect(await validateSessionToken(db, result.token)).toBeNull();
    // Idempotente.
    await expect(revokeSession(db, result.token)).resolves.toBeUndefined();
  });

  it("rejeita tokens desconhecidos ou malformados", async () => {
    expect(await validateSessionToken(db, "invalido")).toBeNull();
    expect(await validateSessionToken(db, "a".repeat(43))).toBeNull();
  });

  it("troca de senha encerra todas as sessões", async () => {
    const user = await createUser(db, { email: "a@b.com", name: "A", password: PASSWORD });
    const result = await login(db, { email: "a@b.com", password: PASSWORD }, opts);
    if (!result.ok) throw new Error("login falhou");
    await changePassword(db, user.id, "OutraSenha456");
    expect(await validateSessionToken(db, result.token)).toBeNull();
    const old = await login(db, { email: "a@b.com", password: PASSWORD }, opts);
    expect(old.ok).toBe(false);
    const fresh = await login(db, { email: "a@b.com", password: "OutraSenha456" }, opts);
    expect(fresh.ok).toBe(true);
  });

  it("limpa sessões expiradas", async () => {
    await createUser(db, { email: "a@b.com", name: "A", password: PASSWORD });
    await login(db, { email: "a@b.com", password: PASSWORD }, opts);
    const future = new Date(Date.now() + 48 * 3600 * 1000);
    const purged = await purgeExpiredAuthData(db, future);
    expect(purged.sessions).toBe(1);
    expect(await db.session.count()).toBe(0);
  });
});
