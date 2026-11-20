import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/server/auth/service";
import { createFund } from "@/server/services/portfolio/fund-service";
import { registerTrade } from "@/server/services/portfolio/operation-service";
import { registerDividendEvent } from "@/server/services/dividends/dividend-service";
import {
  buildConfigFromPortfolio,
  createSimulation,
  deleteSimulation,
  duplicateSimulation,
  getSimulation,
  listSimulations,
  listSimulationVersions,
  restoreSimulationVersion,
  updateSimulation,
} from "@/server/services/simulation/simulation-service";
import { example96Config } from "@/domain/simulation";
import { createPrismaClient } from "@/server/db/factory";
import { createTestDb, resetDatabase } from "../support/db";

const db = createTestDb();
let userId: string;

beforeEach(async () => {
  await resetDatabase(db);
  userId = (await createUser(db, { email: "s@teste.dev", name: "S", password: "SenhaForte123" })).id;
});
afterAll(async () => db.$disconnect());

/** Fotografia de TODAS as tabelas da carteira real. */
async function realPortfolioSnapshot() {
  const [funds, operations, positions, quotes, events, receipts, audit] = await Promise.all([
    db.fund.findMany({ orderBy: { id: "asc" } }),
    db.operation.findMany({ orderBy: { id: "asc" } }),
    db.position.findMany({ orderBy: { fundId: "asc" } }),
    db.priceQuote.findMany({ orderBy: { id: "asc" } }),
    db.dividendEvent.findMany({ orderBy: { id: "asc" } }),
    db.dividendReceipt.findMany({ orderBy: { id: "asc" } }),
    db.auditEvent.count(),
  ]);
  return JSON.stringify({ funds, operations, positions, quotes, events, receipts, audit });
}

async function seedPortfolio() {
  const mxrf = await createFund(db, userId, { ticker: "MXRF11" }, { initialBalance: { quantity: "31", averagePrice: "8.44" }, quote: { price: "8.52" } });
  const knri = await createFund(db, userId, { ticker: "KNRI11" });
  await registerTrade(db, userId, knri.id, { type: "BUY", tradeDate: "2026-01-05", quantity: "2", unitPrice: "150", fees: "0" });
  await registerDividendEvent(db, userId, { fundId: mxrf.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "0.095", dataCom: "2026-10-30", paymentDate: "2026-11-16" });
  return { mxrf, knri };
}

describe("salvar, editar, versões, duplicar e excluir", () => {
  it("ciclo completo com resultados recalculados de forma determinística", async () => {
    const sim = await createSimulation(db, userId, { name: "96 cotas" }, example96Config(12));
    const loaded = await getSimulation(db, userId, sim.id);
    expect(loaded?.result.months[3]).toMatchObject({ endShares: "99", cashRemaining: "8.70" });
    expect(loaded?.scenarios).toHaveLength(4);

    const edited = { ...example96Config(24), monthlyContribution: "100,00" }; // aceita vírgula
    await updateSimulation(db, userId, sim.id, { name: "96 cotas + aporte" }, edited);
    const versions = await listSimulationVersions(db, userId, sim.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect((await getSimulation(db, userId, sim.id))?.config.monthlyContribution).toBe("100");

    await restoreSimulationVersion(db, userId, sim.id, versions[1].id);
    const restored = await getSimulation(db, userId, sim.id);
    expect(restored?.config.months).toBe(12);
    expect((await listSimulationVersions(db, userId, sim.id)).length).toBe(3); // restauração vira nova versão

    const copy = await duplicateSimulation(db, userId, sim.id);
    expect(copy.name).toBe("96 cotas + aporte (cópia)");
    expect((await listSimulations(db, userId)).length).toBe(2);

    await deleteSimulation(db, userId, sim.id);
    expect(await getSimulation(db, userId, sim.id)).toBeNull();
    expect(await db.simulationVersion.count({ where: { simulationId: sim.id } })).toBe(0);
    expect((await listSimulations(db, userId)).map((s) => s.id)).toEqual([copy.id]);
  });

  it("valida a configuração (percentuais, fundos, prazos)", async () => {
    const bad = { ...example96Config(12), allocation: { mode: "WEIGHTS", weights: { F1: "90" } } };
    await expect(createSimulation(db, userId, { name: "x" }, bad)).rejects.toThrow(/somar 100%/);
    await expect(createSimulation(db, userId, { name: "x" }, { ...example96Config(), months: 0 })).rejects.toThrow();
    await expect(createSimulation(db, userId, { name: "" }, example96Config())).rejects.toThrow(/nome/);
    await expect(createSimulation(db, userId, { name: "x" }, { ...example96Config(), extraContributions: [{ month: 99, amount: "10", fundKey: null }] })).rejects.toThrow(/fora do prazo/);
  });

  it("isola dados entre usuários", async () => {
    const sim = await createSimulation(db, userId, { name: "minha" }, example96Config());
    const other = await createUser(db, { email: "o@teste.dev", name: "O", password: "SenhaForte123" });
    expect(await getSimulation(db, other.id, sim.id)).toBeNull();
    await expect(deleteSimulation(db, other.id, sim.id)).rejects.toThrow(/não encontrada/);
  });

  it("persiste após nova conexão", async () => {
    const sim = await createSimulation(db, userId, { name: "persistente" }, example96Config(4));
    const fresh = createPrismaClient(process.env.DATABASE_URL!);
    try {
      expect((await getSimulation(fresh, userId, sim.id))?.result.summary.finalShares).toBe("99");
    } finally {
      await fresh.$disconnect();
    }
  });
});

describe("importação da carteira real e isolamento", () => {
  it("importa uma CÓPIA: quantidade, cotação e último rendimento; avisa o que falta", async () => {
    await seedPortfolio();
    const imp = await buildConfigFromPortfolio(db, userId, 60);
    expect(imp.config.funds.map((f) => [f.ticker, f.initialQuantity, f.price, f.monthlyDividend])).toEqual([
      ["KNRI11", "2", "150.00", "0"],
      ["MXRF11", "31", "8.52", "0.095"],
    ]);
    expect(imp.config.funds[1].calendar).toEqual({ dataComDay: 28, paymentDay: 16, paymentLagMonths: 1 });
    expect(imp.warnings.join(" ")).toMatch(/KNRI11: sem cotação/);
    expect(imp.warnings.join(" ")).toMatch(/KNRI11: nenhum rendimento/);
  });

  it("criar, simular, editar, duplicar e excluir NÃO alteram a carteira real", async () => {
    await seedPortfolio();
    const before = await realPortfolioSnapshot();

    const imp = await buildConfigFromPortfolio(db, userId, 120);
    const sim = await createSimulation(db, userId, { name: "Minha carteira" }, imp.config, "PORTFOLIO");
    const loaded = await getSimulation(db, userId, sim.id);
    expect(Number(loaded!.result.summary.finalShares)).toBeGreaterThan(33); // a simulação compra cotas…
    await updateSimulation(db, userId, sim.id, { name: "Editada" }, { ...imp.config, monthlyContribution: "500" });
    const copy = await duplicateSimulation(db, userId, sim.id);
    await deleteSimulation(db, userId, copy.id);

    // …mas a carteira real continua idêntica
    expect(await realPortfolioSnapshot()).toBe(before);
  });
});
