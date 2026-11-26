import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/refresh/route";
import { getDb } from "@/server/db/client";
import { resetEnvCache } from "@/server/env";
import { createTestDb, resetDatabase } from "../support/db";

/** Rota /api/cron/refresh: segredo comparado em tempo constante + retenção de dados de autenticação. */

const db = createTestDb();
const SECRET = "s".repeat(40);
const call = (authorization?: string) =>
  GET(new NextRequest("http://localhost/api/cron/refresh", { headers: authorization ? { authorization } : {} }));

beforeEach(async () => {
  await resetDatabase(db);
  process.env.CRON_SECRET = SECRET;
  process.env.INTEGRATIONS_ENABLED = "false";
  resetEnvCache();
});
afterAll(async () => {
  delete process.env.CRON_SECRET;
  resetEnvCache();
  await getDb().$disconnect();
  await db.$disconnect();
});

describe("rota de cron", () => {
  it.each([
    ["sem cabeçalho", undefined],
    ["segredo errado (mesmo tamanho)", `Bearer ${"x".repeat(40)}`],
    ["segredo errado (tamanho diferente)", "Bearer curto"],
    ["prefixo do segredo", `Bearer ${SECRET.slice(0, 39)}`],
    ["sem 'Bearer'", SECRET],
  ])("recusa %s com 401", async (_label, authorization) => {
    expect((await call(authorization)).status).toBe(401);
  });

  it("com o segredo: executa a limpeza de retenção (tentativas > 90 dias)", async () => {
    const old = new Date(Date.now() - 100 * 24 * 3600 * 1000);
    await db.loginAttempt.createMany({ data: [{ email: "a@b.c", success: false, createdAt: old }, { email: "a@b.c", success: false }] });
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "disabled" }); // integrações desligadas no teste
    expect(await db.loginAttempt.count()).toBe(1);
  });

  it("sem CRON_SECRET configurado, a rota não existe (404)", async () => {
    delete process.env.CRON_SECRET;
    resetEnvCache();
    expect((await call(`Bearer ${SECRET}`)).status).toBe(404);
  });
});
