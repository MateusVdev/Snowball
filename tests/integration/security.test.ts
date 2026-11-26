import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  checkPasswordWithLimit,
  createUser,
  login,
  purgeExpiredAuthData,
  revokeOtherSessions,
  validateSessionToken,
} from "@/server/auth/service";
import { LOGIN_RATE_LIMIT } from "@/server/auth/rate-limit";
import { addDays, businessDaysBetween } from "@/domain/fixed-income/calendar";
import { example96Config } from "@/domain/simulation";
import { exportBackup, restoreBackup } from "@/server/export/backup";
import type { IndexRateProvider } from "@/server/integrations/types";
import { registerDividendEvent, voidDividendEvent } from "@/server/services/dividends/dividend-service";
import {
  addFixedIncomeMovement,
  createFixedIncomeAsset,
  deleteFixedIncomeMovement,
  updateFixedIncomeAsset,
} from "@/server/services/fixed-income/fixed-income-service";
import {
  INDEX_SYNC_FORCED_MIN_INTERVAL_MS,
  INDEX_SYNC_THROTTLED_MESSAGE,
  syncIndexRates,
} from "@/server/services/fixed-income/index-rate-service";
import { createPrismaClient } from "@/server/db/factory";
import { deleteFixedIncomeSimulation, saveFixedIncomeSimulation } from "@/server/services/fixed-income/simulation-service";
import { createGoal, deleteGoal } from "@/server/services/goals/goal-service";
import { archiveFund, createFund, updateFundInfo } from "@/server/services/portfolio/fund-service";
import { cancelOperation, registerTrade } from "@/server/services/portfolio/operation-service";
import { createSimulation, deleteSimulation } from "@/server/services/simulation/simulation-service";
import { createTestDb, resetDatabase } from "../support/db";

/** Testes de regressão da auditoria de segurança (ver DOCUMENTATION/SECURITY.md). */

const db = createTestDb();
const PASSWORD = "SenhaForte123";
const opts = (ip: string | null) => ({ ttlHours: 1, meta: { ipAddress: ip, userAgent: "vitest" } });

beforeEach(async () => {
  await resetDatabase(db);
});
afterAll(async () => db.$disconnect());

describe("força bruta no login (condição de corrida corrigida)", () => {
  it("30 tentativas SIMULTÂNEAS: no máximo 5 senhas são testadas; depois nem a correta entra", async () => {
    await createUser(db, { email: "alvo@teste.dev", name: "Alvo", password: PASSWORD });
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => login(db, { email: "alvo@teste.dev", password: `chute-${i}` }, opts("203.0.113.9"))),
    );
    const tested = results.filter((r) => !r.ok && r.reason === "invalid_credentials").length;
    // Nunca mais que o limite (antes da correção: 30 de 30). "≤" e não "=": sob
    // contenção extrema, a espera máxima pela trava (1 s) recusa antes — falha fechada.
    expect(tested).toBeLessThanOrEqual(LOGIN_RATE_LIMIT.maxFailuresPerEmailAndIp);
    expect(tested).toBeGreaterThan(0);
    expect(results.filter((r) => !r.ok && r.reason === "rate_limited")).toHaveLength(30 - tested);
    expect(await db.loginAttempt.count({ where: { success: false } })).toBe(tested);
    // Completa o limite de forma sequencial e confirma o bloqueio, mesmo com a senha certa.
    for (let i = tested; i < LOGIN_RATE_LIMIT.maxFailuresPerEmailAndIp; i++) {
      await login(db, { email: "alvo@teste.dev", password: `seq-${i}` }, opts("203.0.113.9"));
    }
    expect(await login(db, { email: "alvo@teste.dev", password: PASSWORD }, opts("203.0.113.9"))).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("sem IP conhecido o limite continua valendo para o e-mail (também em paralelo)", async () => {
    await createUser(db, { email: "semip@teste.dev", name: "X", password: PASSWORD });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => login(db, { email: "semip@teste.dev", password: `x${i}` }, opts(null))),
    );
    const tested = results.filter((r) => !r.ok && r.reason === "invalid_credentials").length;
    expect(tested).toBeLessThanOrEqual(LOGIN_RATE_LIMIT.maxFailuresPerEmailAndIp);
    expect(tested).toBeGreaterThan(0);
  });

  it("um IP atacante não bloqueia o dono em outro IP; o teto global por e-mail continua", async () => {
    await createUser(db, { email: "dono@teste.dev", name: "Dono", password: PASSWORD });
    for (let i = 0; i < 8; i++) await login(db, { email: "dono@teste.dev", password: "errada" }, opts("203.0.113.66"));
    expect(await login(db, { email: "dono@teste.dev", password: PASSWORD }, opts("203.0.113.66"))).toMatchObject({ ok: false, reason: "rate_limited" });
    expect((await login(db, { email: "dono@teste.dev", password: PASSWORD }, opts("198.51.100.10"))).ok).toBe(true);
    // Força bruta distribuída: soma de IPs até o teto global → bloqueia o e-mail.
    const max = LOGIN_RATE_LIMIT.maxFailuresPerEmail;
    for (let i = 0; i < max; i++) {
      await login(db, { email: "dono@teste.dev", password: "errada" }, opts(`192.0.2.${Math.floor(i / 5) + 1}`));
    }
    expect(await login(db, { email: "dono@teste.dev", password: PASSWORD }, opts("198.51.100.10"))).toMatchObject({ reason: "rate_limited" });
  });

  it("tentativas bem-sucedidas ficam registradas como sucesso (não contam como falha)", async () => {
    await createUser(db, { email: "ok@teste.dev", name: "Ok", password: PASSWORD });
    for (let i = 0; i < 8; i++) expect((await login(db, { email: "ok@teste.dev", password: PASSWORD }, opts("203.0.113.1"))).ok).toBe(true);
    expect(await db.loginAttempt.count({ where: { success: true } })).toBe(8);
    expect(await db.loginAttempt.count({ where: { success: false } })).toBe(0);
  });
});

describe("senha atual na troca de senha (antes sem limite)", () => {
  it("após 5 erros fica bloqueada, mesmo com a senha correta, e o bloqueio vale também para o login", async () => {
    const user = await createUser(db, { email: "troca@teste.dev", name: "T", password: PASSWORD });
    const meta = { meta: { ipAddress: "203.0.113.20" } };
    const parallel = await Promise.all(Array.from({ length: 10 }, (_, i) => checkPasswordWithLimit(db, user.id, `chute${i}`, meta)));
    const tested = parallel.filter((r) => r === "invalid").length;
    expect(tested).toBeLessThanOrEqual(LOGIN_RATE_LIMIT.maxFailuresPerEmailAndIp);
    expect(tested).toBeGreaterThan(0);
    for (let i = tested; i < LOGIN_RATE_LIMIT.maxFailuresPerEmailAndIp; i++) await checkPasswordWithLimit(db, user.id, `seq${i}`, meta);
    expect(await checkPasswordWithLimit(db, user.id, PASSWORD, meta)).toBe("rate_limited");
    expect(await login(db, { email: "troca@teste.dev", password: PASSWORD }, opts("203.0.113.20"))).toMatchObject({ reason: "rate_limited" });
    // Fora da janela, volta ao normal.
    const later = new Date(Date.now() + LOGIN_RATE_LIMIT.windowMs + 1000);
    expect(await checkPasswordWithLimit(db, user.id, PASSWORD, { ...meta, now: later })).toBe("ok");
  });
});

describe("retenção de dados de autenticação", () => {
  it("remove tentativas de login com mais de 90 dias e sessões vencidas", async () => {
    const old = new Date(Date.now() - 100 * 24 * 3600 * 1000);
    await db.loginAttempt.createMany({ data: [{ email: "a@b.c", success: false, createdAt: old }, { email: "a@b.c", success: false }] });
    const r = await purgeExpiredAuthData(db);
    expect(r.attempts).toBe(1);
    expect(await db.loginAttempt.count()).toBe(1);
  });
});

describe("isolamento entre usuários (IDOR/BOLA) — matriz de escrita", () => {
  it("o usuário B não altera nem apaga nada do usuário A", async () => {
    const a = await createUser(db, { email: "a@teste.dev", name: "A", password: PASSWORD });
    const b = await createUser(db, { email: "b@teste.dev", name: "B", password: PASSWORD });
    const fund = await createFund(db, a.id, { ticker: "MXRF11" }, { initialBalance: { quantity: "10", averagePrice: "10" }, quote: { price: "10" } });
    const trade = await registerTrade(db, a.id, fund.id, { type: "BUY", tradeDate: "2026-01-05", quantity: "1", unitPrice: "10", fees: "0" });
    const event = await registerDividendEvent(db, a.id, { fundId: fund.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "0.1", dataCom: "2026-01-05" });
    const sim = await createSimulation(db, a.id, { name: "Sim A" }, example96Config(6));
    const goal = await createGoal(db, a.id, { name: "Meta A", metric: "PATRIMONY", target: "1000" });
    const asset = await createFixedIncomeAsset(db, a.id, { name: "CDB A", productType: "CDB", indexer: "CDI", rate: "100" });
    const movement = await addFixedIncomeMovement(db, a.id, asset.id, { type: "DEPOSIT", date: "2026-01-05", amount: "100" });
    const fiSim = await saveFixedIncomeSimulation(db, a.id, {
      name: "RF A",
      params: { initialAmount: "100", monthlyContribution: "0", termValue: "6", termUnit: "MONTHS", rateMode: "CDI_PERCENT", cdiPercent: "100", cdiAnnualPercent: "12", startDate: "2026-01-05" },
    });
    const reason = "Motivo de teste de segurança";

    const attempts: [string, () => Promise<unknown>][] = [
      ["editar fundo", () => updateFundInfo(db, b.id, fund.id, { name: "hack" })],
      ["arquivar fundo", () => archiveFund(db, b.id, fund.id)],
      ["operar no fundo de A", () => registerTrade(db, b.id, fund.id, { type: "SELL", tradeDate: "2026-01-06", quantity: "1", unitPrice: "1", fees: "0" })],
      ["cancelar operação", () => cancelOperation(db, b.id, trade.id, reason)],
      ["provento no fundo de A", () => registerDividendEvent(db, b.id, { fundId: fund.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "9", dataCom: "2026-01-05" })],
      ["anular provento", () => voidDividendEvent(db, b.id, event.id, reason)],
      ["excluir simulação", () => deleteSimulation(db, b.id, sim.id)],
      ["excluir meta", () => deleteGoal(db, b.id, goal.id)],
      ["meta de B ligada à simulação de A", () => createGoal(db, b.id, { name: "x", metric: "PATRIMONY", target: "1", simulationId: sim.id })],
      ["editar título", () => updateFixedIncomeAsset(db, b.id, asset.id, { name: "hack", productType: "CDB", indexer: "CDI", rate: "999" })],
      ["excluir movimento", () => deleteFixedIncomeMovement(db, b.id, movement)],
      ["excluir simulação de renda fixa", () => deleteFixedIncomeSimulation(db, b.id, fiSim)],
    ];
    for (const [label, attempt] of attempts) {
      await expect(attempt(), label).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|INVALID/) });
    }

    // Nada de A mudou.
    expect((await db.fund.findUniqueOrThrow({ where: { id: fund.id } })).name).toBeNull();
    expect(await db.operation.count({ where: { fundId: fund.id, status: "ACTIVE" } })).toBe(2);
    expect((await db.dividendEvent.findUniqueOrThrow({ where: { id: event.id } })).voidedAt).toBeNull();
    expect(await db.simulation.count({ where: { userId: a.id } })).toBe(1);
    expect(await db.financialGoal.count({ where: { userId: a.id } })).toBe(1);
    expect((await db.fixedIncomeAsset.findUniqueOrThrow({ where: { id: asset.id } })).rate.toString()).toBe("100");
    expect(await db.fixedIncomeMovement.count({ where: { assetId: asset.id } })).toBe(1);
    expect(await db.fixedIncomeSimulation.count({ where: { userId: a.id } })).toBe(1);
    expect(await db.dividendEvent.count({ where: { userId: b.id } })).toBe(0);
  });

  it("sessões: o token de A só identifica A; B não encerra as sessões de A", async () => {
    await createUser(db, { email: "a@teste.dev", name: "A", password: PASSWORD });
    await createUser(db, { email: "b@teste.dev", name: "B", password: PASSWORD });
    const la = await login(db, { email: "a@teste.dev", password: PASSWORD }, opts("203.0.113.1"));
    const lb = await login(db, { email: "b@teste.dev", password: PASSWORD }, opts("203.0.113.2"));
    if (!la.ok || !lb.ok) throw new Error("login falhou");
    await revokeOtherSessions(db, lb.user.id, lb.token);
    expect((await validateSessionToken(db, la.token))?.email).toBe("a@teste.dev");
    expect((await validateSessionToken(db, lb.token))?.email).toBe("b@teste.dev");
  });
});

describe("restauração de backup adulterado", () => {
  async function backupWithAsset() {
    const a = await createUser(db, { email: "a@teste.dev", name: "A", password: PASSWORD });
    const asset = await createFixedIncomeAsset(db, a.id, { name: "CDB", productType: "CDB", indexer: "CDI", rate: "100" });
    await addFixedIncomeMovement(db, a.id, asset.id, { type: "DEPOSIT", date: "2026-01-05", amount: "100" });
    return JSON.parse(JSON.stringify(await exportBackup(db, a.id)));
  }
  const resign = (b: { data: unknown; checksum: string }) => {
    b.checksum = createHash("sha256").update(JSON.stringify(b.data)).digest("hex");
    return b;
  };

  type Tamperable = { data: { fixedIncomeAssets: Record<string, unknown>[]; fixedIncomeMovements: Record<string, unknown>[] } };
  it.each<[string, (b: Tamperable) => void]>([
    ["indexador não suportado (derrubaria as telas)", (b) => { b.data.fixedIncomeAssets[0].indexer = "IPCA"; }],
    ["percentual zero", (b) => { b.data.fixedIncomeAssets[0].rate = "0"; }],
    ["Tesouro Selic com CDI", (b) => { b.data.fixedIncomeAssets[0].productType = "TESOURO_SELIC"; }],
    ["movimento com valor negativo", (b) => { b.data.fixedIncomeMovements[0].amount = "-5"; }],
    ["movimento com 3 casas decimais", (b) => { b.data.fixedIncomeMovements[0].amount = "1.001"; }],
  ])("recusa %s sem gravar nada", async (_label, tamper) => {
    const backup = await backupWithAsset();
    tamper(backup);
    const fresh = await createUser(db, { email: "novo@teste.dev", name: "N", password: PASSWORD });
    await expect(restoreBackup(db, fresh.id, resign(backup))).rejects.toThrow(/inválid/);
    expect(await db.fixedIncomeAsset.count({ where: { userId: fresh.id } })).toBe(0);
  });

  it("dados do backup sempre vão para a conta de quem restaura (IDs novos)", async () => {
    const backup = await backupWithAsset();
    const fresh = await createUser(db, { email: "novo@teste.dev", name: "N", password: PASSWORD });
    await restoreBackup(db, fresh.id, backup);
    const restored = await db.fixedIncomeAsset.findFirstOrThrow({ where: { userId: fresh.id } });
    expect(restored.id).not.toBe(backup.data.fixedIncomeAssets[0].id);
    expect(await db.fixedIncomeAsset.count()).toBe(2); // o original continua com o dono original
  });
});

describe("atualização forçada dos índices não martela o Banco Central", () => {
  it("dois cliques seguidos: só a primeira consulta vai à API; depois de 2 minutos libera", async () => {
    const calls: string[] = [];
    const provider: IndexRateProvider = {
      id: "BCB",
      name: "Banco Central (simulado)",
      async getDailyRates(_i, from, to) {
        calls.push(`${from}..${to}`);
        return businessDaysBetween(from, addDays(to, 1)).map((date) => ({ date, dailyRatePercent: "0.05" }));
      },
    };
    const t0 = new Date("2026-11-20T12:00:00Z");
    await syncIndexRates(db, provider, "CDI", { from: "2026-11-02", to: "2026-11-10", now: t0, force: true });
    const again = await syncIndexRates(db, provider, "CDI", { from: "2026-11-02", to: "2026-11-19", now: new Date(t0.getTime() + 30_000), force: true });
    expect(again.status).toBe("SKIPPED");
    expect(calls).toHaveLength(1);
    const later = new Date(t0.getTime() + INDEX_SYNC_FORCED_MIN_INTERVAL_MS + 1000);
    expect((await syncIndexRates(db, provider, "CDI", { from: "2026-11-02", to: "2026-11-19", now: later, force: true })).status).toBe("SUCCESS");
    expect(calls).toHaveLength(2);
  });
});

describe("segunda revisão de segurança", () => {
  const attackLogin = (client: typeof db, email: string, password: string, ip: string | null) =>
    login(client, { email, password }, opts(ip)).then(
      (r) => (r.ok ? "ok" : r.reason),
      (e: unknown) => `erro: ${String((e as Error).message).split("\n")[0]}`,
    );

  it("a corrida continua fechada mesmo se o banco usar REPEATABLE READ (isolamento explícito)", async () => {
    await createUser(db, { email: "rr@teste.dev", name: "RR", password: PASSWORD });
    const base = process.env.DATABASE_URL!;
    const rr = createPrismaClient(`${base}${base.includes("?") ? "&" : "?"}options=${encodeURIComponent("-c default_transaction_isolation=repeatable\\ read")}`);
    try {
      const [{ i }] = await rr.$queryRaw<{ i: string }[]>`SELECT current_setting('default_transaction_isolation') AS i`;
      expect(i).toBe("repeatable read");
      const results = await Promise.all(Array.from({ length: 30 }, (_, k) => attackLogin(rr, "rr@teste.dev", `x${k}`, "203.0.113.9")));
      // Antes da correção: 14 de 30 senhas testadas neste cenário.
      expect(results.filter((r) => r === "invalid_credentials").length).toBeLessThanOrEqual(LOGIN_RATE_LIMIT.maxFailuresPerEmailAndIp);
    } finally {
      await rr.$disconnect();
    }
  });

  it("fila na trava não prende o pool: espera limitada e o resto do app segue respondendo", async () => {
    await createUser(db, { email: "fila@teste.dev", name: "F", password: PASSWORD });
    const holder = createPrismaClient(process.env.DATABASE_URL!);
    // Outra conexão segura a trava do e-mail por 6 s (fila longa).
    const hold = holder.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('login:email:fila@teste.dev', 0))`;
      await new Promise((r) => setTimeout(r, 6000));
    }, { timeout: 15_000 });
    try {
      await new Promise((r) => setTimeout(r, 300));
      const started = Date.now();
      const logins = Promise.all(Array.from({ length: 12 }, (_, k) => attackLogin(db, "fila@teste.dev", `x${k}`, `203.0.113.${k + 1}`)));
      await new Promise((r) => setTimeout(r, 200));
      const q = Date.now();
      await db.user.count(); // qualquer outra consulta do app
      const otherQueryMs = Date.now() - q;
      const results = await logins;
      // Antes: outra consulta esperou ~7 s (pool inteiro preso) e houve erros.
      expect(otherQueryMs).toBeLessThan(3000);
      expect(Date.now() - started).toBeLessThan(5000);
      expect(new Set(results)).toEqual(new Set(["rate_limited"])); // falha fechada: nenhuma senha testada
      expect(await db.loginAttempt.count()).toBe(0);
    } finally {
      await hold;
      await holder.$disconnect();
    }
  }, 30_000);

  it("IPv6: trocar de endereço dentro do mesmo /64 não dá limite novo", async () => {
    await createUser(db, { email: "v6@teste.dev", name: "V6", password: PASSWORD });
    let tested = 0;
    for (let host = 1; host <= 10; host++) {
      for (let k = 0; k < 5; k++) {
        if ((await attackLogin(db, "v6@teste.dev", `x${host}-${k}`, `2001:db8:1:2::${host.toString(16)}`)) === "invalid_credentials") tested++;
      }
    }
    expect(tested).toBe(LOGIN_RATE_LIMIT.maxFailuresPerEmailAndIp); // antes: 30
    // Outro /64 é outro cliente.
    expect(await attackLogin(db, "v6@teste.dev", PASSWORD, "2001:db8:1:3::1")).toBe("ok");
    // IPv4 mapeado em IPv6 = o mesmo IPv4.
    for (let k = 0; k < 5; k++) await attackLogin(db, "v6@teste.dev", `y${k}`, "198.51.100.7");
    expect(await attackLogin(db, "v6@teste.dev", PASSWORD, "::ffff:198.51.100.7")).toBe("rate_limited");
  });

  it("índices: taxas antigas que faltam não esperam 1 hora; o 'forçar' repetido avisa que nada foi buscado", async () => {
    const calls: string[] = [];
    const provider: IndexRateProvider = {
      id: "BCB",
      name: "Banco Central (simulado)",
      async getDailyRates(_i, from, to) {
        calls.push(`${from}..${to}`);
        return businessDaysBetween(from, addDays(to, 1)).map((date) => ({ date, dailyRatePercent: "0.05" }));
      },
    };
    const t0 = new Date("2026-11-20T12:00:00Z");
    await syncIndexRates(db, provider, "CDI", { from: "2026-10-01", to: "2026-11-19", now: t0 });
    // 3 min depois, um aporte antigo (setembro) precisa de taxas anteriores: busca já, sem esperar 1 h.
    const backfill = await syncIndexRates(db, provider, "CDI", { from: "2026-09-01", to: "2026-11-19", now: new Date(t0.getTime() + 3 * 60_000) });
    expect(backfill.status).toBe("SUCCESS");
    expect(calls.at(-1)).toBe("2026-09-01..2026-09-30");
    // Clique repetido logo em seguida: nada é buscado e a mensagem diz isso.
    const again = await syncIndexRates(db, provider, "CDI", { from: "2026-08-01", to: "2026-11-25", now: new Date(t0.getTime() + 3 * 60_000 + 10_000), force: true });
    expect(again).toMatchObject({ status: "SKIPPED", message: INDEX_SYNC_THROTTLED_MESSAGE });
    // Já atualizado (nada a buscar): SKIPPED sem mensagem de intervalo.
    const upToDate = await syncIndexRates(db, provider, "CDI", { from: "2026-09-01", to: "2026-11-19", now: new Date(t0.getTime() + 60 * 60_000) });
    expect(upToDate).toMatchObject({ status: "SKIPPED", message: null });
  });
});
