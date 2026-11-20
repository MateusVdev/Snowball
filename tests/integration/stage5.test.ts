import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, login, revokeOtherSessions, validateSessionToken, verifyUserPassword } from "@/server/auth/service";
import { createFund, getPortfolio } from "@/server/services/portfolio/fund-service";
import { cancelOperation, correctOperation, registerTrade } from "@/server/services/portfolio/operation-service";
import { confirmReceipt, getDividendsOverview, registerDividendEvent } from "@/server/services/dividends/dividend-service";
import { createSimulation, getSimulation } from "@/server/services/simulation/simulation-service";
import { createGoal, deleteGoal, listGoalStatuses } from "@/server/services/goals/goal-service";
import { getOverview } from "@/server/services/overview/overview-service";
import { exportBackup, restoreBackup } from "@/server/export/backup";
import { example96Config } from "@/domain/simulation";
import { createTestDb, resetDatabase } from "../support/db";

/**
 * datasets.ts usa "server-only" (neutralizado nos testes) — importado aqui
 * para verificar o escopo por usuário das exportações.
 */
import { buildDataset } from "@/server/export/datasets";

const db = createTestDb();
let userId: string;

beforeEach(async () => {
  await resetDatabase(db);
  userId = (await createUser(db, { email: "f@teste.dev", name: "F", password: "SenhaForte123" })).id;
});
afterAll(async () => db.$disconnect());

async function seed() {
  const mxrf = await createFund(db, userId, { ticker: "MXRF11", segment: "Recebíveis" }, { initialBalance: { quantity: "31", averagePrice: "8.44" }, quote: { price: "8.52" } });
  const knri = await createFund(db, userId, { ticker: "KNRI11" }, { quote: { price: "160" } });
  const buy = await registerTrade(db, userId, knri.id, { type: "BUY", tradeDate: "2026-01-05", quantity: "10", unitPrice: "150", fees: "1" });
  const wrong = await registerTrade(db, userId, knri.id, { type: "BUY", tradeDate: "2026-02-05", quantity: "9", unitPrice: "150", fees: "0" });
  await correctOperation(db, userId, wrong.id, { tradeDate: "2026-02-05", quantity: "2", unitPrice: "150", fees: "0" }, "Quantidade errada");
  const sell = await registerTrade(db, userId, knri.id, { type: "SELL", tradeDate: "2026-03-05", quantity: "2", unitPrice: "155", fees: "0" });
  await cancelOperation(db, userId, sell.id, "Ordem não executada");
  const ev = await registerDividendEvent(db, userId, { fundId: knri.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "1.10", dataCom: "2026-09-30", paymentDate: "2026-10-14" });
  await confirmReceipt(db, userId, ev.id, {}, "2026-11-20");
  await registerDividendEvent(db, userId, { fundId: mxrf.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "0.095", dataCom: "2026-10-30", paymentDate: "2026-11-16" });
  const sim = await createSimulation(db, userId, { name: "96" }, example96Config(24));
  await createGoal(db, userId, { name: "100 cotas", metric: "TOTAL_SHARES", target: "100", simulationId: sim.id });
  return { mxrf, knri, buy, sim };
}

describe("visão geral e metas", () => {
  it("valores vêm do banco e batem com os serviços das etapas anteriores", async () => {
    await seed();
    const o = await getOverview(db, userId, { todayIso: "2026-11-20" });
    // KNRI11: 10 × 150 + 1 + 2 × 150 = 1.801,00; MXRF11: 261,64 → investido 2.062,64
    expect(o.portfolio.totals.investedCapital.toFixed(2)).toBe("2062.64");
    // Valor: 12 × 160 + 31 × 8,52 = 1.920 + 264,12 = 2.184,12
    expect(o.portfolio.totals.currentValue.toFixed(2)).toBe("2184.12");
    expect(o.totalShares.toString()).toBe("43");
    // Na data-com (30/09) havia 10 + 2 = 12 cotas (compra corrigida; venda cancelada): 12 × 1,10
    expect(o.dividends.income.totalReceived.toFixed(2)).toBe("13.20");
    expect(o.dividendsThisYear.toFixed(2)).toBe("13.20");
    // Renda recorrente: KNRI 12 × 1,10 = 13,20; MXRF 31 × 0,095 = 2,945 → 2,95 → 16,15
    expect(o.recurringIncome.total.toFixed(2)).toBe("16.15");
    // Aportes: jan 1.501; fev 300 (correção); venda cancelada não conta
    expect(o.flows.map((f) => [f.month, f.net.toFixed(2)])).toEqual([["2026-01", "1501.00"], ["2026-02", "300.00"]]);
    expect(o.initialBalancesCost.toFixed(2)).toBe("261.64");
    expect(o.byFund[0].label).toBe("KNRI11");
    expect(o.bySegment.map((s) => s.label)).toEqual(["Segmento não informado", "Recebíveis"]);
  });

  it("metas: progresso pelo banco e estimativa pela simulação vinculada", async () => {
    await seed();
    const o = await getOverview(db, userId, { todayIso: "2026-11-20" });
    const [g] = await listGoalStatuses(db, userId, o);
    expect(g.current?.toString()).toBe("43");
    expect(g.remaining?.toString()).toBe("57");
    expect(g.estimate).toMatchObject({ months: 5 }); // 96 → 100 cotas no mês 5 da simulação
    await deleteGoal(db, userId, g.id);
    expect(await listGoalStatuses(db, userId, o)).toHaveLength(0);
    await expect(createGoal(db, userId, { name: "x", metric: "TOTAL_SHARES", target: "10,5" })).rejects.toThrow(/inteira/);
    await expect(createGoal(db, userId, { name: "x", metric: "PATRIMONY", target: "1000", simulationId: "inexistente" })).rejects.toThrow(/Simulação/);
  });
});

describe("backup e restauração", () => {
  it("ida e volta: outra conta recebe exatamente a mesma carteira, proventos e simulações", async () => {
    const { sim } = await seed();
    const backup = JSON.parse(JSON.stringify(await exportBackup(db, userId)));
    expect(JSON.stringify(backup)).not.toMatch(/passwordHash|password_hash|tokenHash/);

    const other = await createUser(db, { email: "novo@teste.dev", name: "Novo", password: "SenhaForte123" });
    const r = await restoreBackup(db, other.id, backup);
    expect(r).toMatchObject({ funds: 2, operations: 5, dividendEvents: 2, receipts: 1, simulations: 1, goals: 1 });

    const a = await getPortfolio(db, userId);
    const b = await getPortfolio(db, other.id);
    const view = (p: typeof a) => p.positions.map((x) => [x.ticker, x.metrics.quantity.toString(), x.metrics.investedCapital.toFixed(8), x.metrics.realizedResult.toFixed(8), x.quote?.price]);
    expect(view(b)).toEqual(view(a));
    const da = await getDividendsOverview(db, userId, { todayIso: "2026-11-20" });
    const dbb = await getDividendsOverview(db, other.id, { todayIso: "2026-11-20" });
    expect(dbb.income.totalReceived.toString()).toBe(da.income.totalReceived.toString());
    const restoredSim = await db.simulation.findFirstOrThrow({ where: { userId: other.id } });
    expect(restoredSim.id).not.toBe(sim.id); // novos IDs
    expect((await getSimulation(db, other.id, restoredSim.id))?.result.summary).toEqual((await getSimulation(db, userId, sim.id))?.result.summary);
    // Operações corrigidas/canceladas preservadas com rastreabilidade
    const ops = await db.operation.findMany({ where: { userId: other.id } });
    expect(ops.filter((o) => o.status === "SUPERSEDED")).toHaveLength(1);
    expect(ops.filter((o) => o.correctsId)).toHaveLength(1);
    expect(ops.find((o) => o.correctsId)!.correctsId).toBe(ops.find((o) => o.status === "SUPERSEDED")!.id);
  });

  it("recusa restaurar em conta com dados, arquivo adulterado ou inválido", async () => {
    await seed();
    const backup = JSON.parse(JSON.stringify(await exportBackup(db, userId)));
    await expect(restoreBackup(db, userId, backup)).rejects.toThrow(/sem dados/);
    const other = await createUser(db, { email: "x@teste.dev", name: "X", password: "SenhaForte123" });
    const tampered = structuredClone(backup);
    tampered.data.operations[0].quantity = "9999";
    await expect(restoreBackup(db, other.id, tampered)).rejects.toThrow(/Checksum/);
    await expect(restoreBackup(db, other.id, { format: "outro" })).rejects.toThrow(/inválido/);
    expect(await db.fund.count({ where: { userId: other.id } })).toBe(0); // nada gravado
  });
});

describe("exportação e segurança da conta", () => {
  it("exportações contêm apenas os dados do próprio usuário", async () => {
    await seed();
    const other = await createUser(db, { email: "y@teste.dev", name: "Y", password: "SenhaForte123" });
    for (const k of ["carteira", "operacoes", "cotacoes", "proventos", "recebimentos", "simulacoes"] as const) {
      expect((await buildDataset(db, other.id, k)).rows).toHaveLength(0);
      expect((await buildDataset(db, userId, k)).rows.length).toBeGreaterThan(0);
    }
  });

  it("senha atual conferida e encerramento das outras sessões", async () => {
    const opts = { ttlHours: 24 };
    const s1 = await login(db, { email: "f@teste.dev", password: "SenhaForte123" }, opts);
    const s2 = await login(db, { email: "f@teste.dev", password: "SenhaForte123" }, opts);
    if (!s1.ok || !s2.ok) throw new Error("login");
    expect(await verifyUserPassword(db, userId, "SenhaForte123")).toBe(true);
    expect(await verifyUserPassword(db, userId, "errada")).toBe(false);
    expect(await revokeOtherSessions(db, userId, s1.token)).toBe(1);
    expect(await validateSessionToken(db, s1.token)).not.toBeNull();
    expect(await validateSessionToken(db, s2.token)).toBeNull();
  });
});
