import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/server/auth/service";
import { addDays, businessDaysBetween, fromIso } from "@/domain/fixed-income/calendar";
import { todayIsoDate } from "@/domain/dates";
import { exportBackup, restoreBackup } from "@/server/export/backup";
import { buildDataset } from "@/server/export/datasets";
import { createFund } from "@/server/services/portfolio/fund-service";
import {
  addFixedIncomeMovement,
  createFixedIncomeAsset,
  listFixedIncomeAssets,
  setFixedIncomeAssetArchived,
} from "@/server/services/fixed-income/fixed-income-service";
import { ensureIndexRates } from "@/server/services/fixed-income/refresh";
import type { IndexRateProvider } from "@/server/integrations/types";
import { createTestDb, resetDatabase } from "../support/db";

const db = createTestDb();
let userId: string;

beforeEach(async () => {
  await resetDatabase(db);
  userId = (await createUser(db, { email: "bk@teste.dev", name: "BK", password: "SenhaForte123" })).id;
  const days = businessDaysBetween("2025-01-01", "2026-01-01");
  await db.indexDailyRate.createMany({
    data: [
      ...days.map((d) => ({ indexer: "CDI" as const, date: fromIso(d), dailyRatePercent: "0.045" })),
      ...days.map((d) => ({ indexer: "SELIC" as const, date: fromIso(d), dailyRatePercent: "0.044" })),
    ],
  });
});
afterAll(async () => db.$disconnect());

async function seed(owner = userId) {
  const caixinha = await createFixedIncomeAsset(db, owner, { name: "Caixinha Turbo", issuer: "Nubank", productType: "CDB", indexer: "CDI", rate: "115" });
  await addFixedIncomeMovement(db, owner, caixinha.id, { type: "DEPOSIT", date: "2025-01-02", amount: "1000" });
  await addFixedIncomeMovement(db, owner, caixinha.id, { type: "DEPOSIT", date: "2025-03-10", amount: "91" });
  await addFixedIncomeMovement(db, owner, caixinha.id, { type: "WITHDRAWAL", date: "2025-06-02", amount: "300", notes: "resgate parcial" });
  const lca = await createFixedIncomeAsset(db, owner, { name: "LCA 90%", productType: "LCA", indexer: "CDI", rate: "90", maturityDate: "2027-01-04", spreadAnnualPercent: "0,1" });
  await addFixedIncomeMovement(db, owner, lca.id, { type: "DEPOSIT", date: "2025-02-03", amount: "500" });
  await setFixedIncomeAssetArchived(db, owner, lca.id, true);
  const tesouro = await createFixedIncomeAsset(db, owner, { name: "Tesouro Selic 2029", productType: "TESOURO_SELIC", indexer: "SELIC", rate: "100" });
  await addFixedIncomeMovement(db, owner, tesouro.id, { type: "DEPOSIT", date: "2025-04-01", amount: "2000" });
  return { caixinha, lca, tesouro };
}

/** Recalcula o checksum como o exportador (para simular arquivos de versões anteriores). */
function resign(backup: { data: unknown; checksum: string }) {
  backup.checksum = createHash("sha256").update(JSON.stringify(backup.data)).digest("hex");
  return backup;
}

const view = async (owner: string) =>
  (await listFixedIncomeAssets(db, owner, { includeArchived: true, asOf: "2025-12-01" })).assets.map((a) => ({
    name: a.name, issuer: a.issuer, productType: a.productType, indexer: a.indexer, rate: a.rate, spread: a.spreadAnnualPercent,
    taxExempt: a.taxExempt, dailyLiquidity: a.dailyLiquidity, maturityDate: a.maturityDate, archived: a.archivedAt !== null,
    movements: a.movements.map((m) => [m.type, m.date, m.amount, m.notes]),
    gross: a.result.current.gross.toFixed(10), net: a.result.current.net.toFixed(10),
    withdrawalsGross: a.result.withdrawals.map((w) => w.gross.toFixed(10)),
  }));

describe("backup e restauração com renda fixa", () => {
  it("ida e volta: títulos, movimentos e valores estimados idênticos em outra conta", async () => {
    await seed();
    await createFund(db, userId, { ticker: "MXRF11" }, { initialBalance: { quantity: "10", averagePrice: "10" } });
    const backup = JSON.parse(JSON.stringify(await exportBackup(db, userId)));
    expect(backup.data.fixedIncomeAssets).toHaveLength(3);
    expect(backup.data.fixedIncomeMovements).toHaveLength(5);
    expect(JSON.stringify(backup)).not.toMatch(/index_daily_rates|dailyRatePercent/); // cache público fica fora

    const other = await createUser(db, { email: "novo@teste.dev", name: "Novo", password: "SenhaForte123" });
    const r = await restoreBackup(db, other.id, backup);
    expect(r).toMatchObject({ funds: 1, fixedIncomeAssets: 3, fixedIncomeMovements: 5 });

    expect(await view(other.id)).toEqual(await view(userId));
    // Novos IDs; nada do usuário original foi alterado.
    const restored = await db.fixedIncomeAsset.findMany({ where: { userId: other.id } });
    const original = await db.fixedIncomeAsset.findMany({ where: { userId } });
    expect(restored.map((a) => a.id).some((id) => original.some((o) => o.id === id))).toBe(false);
    expect(await db.fixedIncomeMovement.count({ where: { userId } })).toBe(5);
    // Auditoria restaurada aponta para os novos IDs.
    const audit = await db.auditEvent.findMany({ where: { userId: other.id, entityType: "fixed_income_asset" } });
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((a) => restored.some((x) => x.id === a.entityId))).toBe(true);
  });

  it("backup antigo (sem renda fixa) continua sendo restaurado", async () => {
    await createFund(db, userId, { ticker: "MXRF11" }, { initialBalance: { quantity: "10", averagePrice: "10" } });
    const backup = JSON.parse(JSON.stringify(await exportBackup(db, userId)));
    delete backup.data.fixedIncomeAssets;
    delete backup.data.fixedIncomeMovements;
    const other = await createUser(db, { email: "velho@teste.dev", name: "Velho", password: "SenhaForte123" });
    const r = await restoreBackup(db, other.id, resign(backup));
    expect(r).toMatchObject({ funds: 1, fixedIncomeAssets: 0, fixedIncomeMovements: 0 });
  });

  it("recusa restaurar em conta que já tem renda fixa, arquivo adulterado ou movimento órfão", async () => {
    await seed();
    const backup = JSON.parse(JSON.stringify(await exportBackup(db, userId)));

    // Conta só com renda fixa também conta como "com dados".
    const withFi = await createUser(db, { email: "rf@teste.dev", name: "RF", password: "SenhaForte123" });
    await createFixedIncomeAsset(db, withFi.id, { name: "X", productType: "CDB", indexer: "CDI", rate: "100" });
    await expect(restoreBackup(db, withFi.id, backup)).rejects.toThrow(/sem dados/);

    const other = await createUser(db, { email: "x@teste.dev", name: "X", password: "SenhaForte123" });
    const tampered = structuredClone(backup);
    tampered.data.fixedIncomeMovements[0].amount = "999999";
    await expect(restoreBackup(db, other.id, tampered)).rejects.toThrow(/Checksum/);

    const orphan = structuredClone(backup);
    orphan.data.fixedIncomeMovements[0].assetId = "nao-existe";
    await expect(restoreBackup(db, other.id, resign(orphan))).rejects.toThrow(/inexistente/);

    const badType = structuredClone(backup);
    badType.data.fixedIncomeAssets[0].indexer = "DOLAR";
    await expect(restoreBackup(db, other.id, resign(badType))).rejects.toThrow(/inválido/);

    // Nada gravado nas tentativas recusadas (transação inteira desfeita).
    expect(await db.fixedIncomeAsset.count({ where: { userId: other.id } })).toBe(0);
    expect(await db.fixedIncomeMovement.count({ where: { userId: other.id } })).toBe(0);
  });
});

describe("exportação e isolamento por usuário", () => {
  it("exportações de renda fixa trazem só os dados do próprio usuário", async () => {
    await seed();
    const other = await createUser(db, { email: "y@teste.dev", name: "Y", password: "SenhaForte123" });
    await seed(other.id);
    await createFixedIncomeAsset(db, other.id, { name: "Só do outro", productType: "RDB", indexer: "CDI", rate: "100" });

    const mine = await buildDataset(db, userId, "renda-fixa");
    const theirs = await buildDataset(db, other.id, "renda-fixa");
    expect(mine.rows).toHaveLength(3);
    expect(theirs.rows).toHaveLength(4);
    const ids = (ds: typeof mine) => new Set(ds.rows.map((r) => r[0].v));
    const myIds = ids(mine);
    expect([...ids(theirs)].some((id) => myIds.has(id))).toBe(false);
    expect(mine.rows.map((r) => r[1].v)).not.toContain("Só do outro");
    expect(mine.rows.find((r) => r[1].v === "Caixinha Turbo")![4].v).toBe("115% do CDI");

    const moves = await buildDataset(db, userId, "renda-fixa-movimentos");
    expect(moves.rows).toHaveLength(5);
    const withdrawal = moves.rows.find((r) => r[2].v === "Resgate")!;
    expect(withdrawal[4].v).toBe("300");
    expect(Number(withdrawal[5].v)).toBeGreaterThan(300); // bruto equivalente

    const third = await createUser(db, { email: "z@teste.dev", name: "Z", password: "SenhaForte123" });
    expect((await buildDataset(db, third.id, "renda-fixa")).rows).toHaveLength(0);
    expect((await buildDataset(db, third.id, "renda-fixa-movimentos")).rows).toHaveLength(0);

    const backup = await exportBackup(db, userId);
    expect(backup.data.fixedIncomeAssets.map((a) => a.name)).not.toContain("Só do outro");
    expect(backup.data.fixedIncomeMovements).toHaveLength(5);
    expect((await exportBackup(db, third.id)).data.fixedIncomeAssets).toHaveLength(0);
  });

  it("atualização dos índices na abertura da tela: só desde o 1º movimento do usuário, sem provedor não faz nada", async () => {
    await resetDatabase(db);
    userId = (await createUser(db, { email: "idx@teste.dev", name: "Idx", password: "SenhaForte123" })).id;
    const calls: [string, string, string][] = [];
    const provider: IndexRateProvider = {
      id: "BCB",
      name: "Banco Central (simulado)",
      async getDailyRates(indexer, from, to) {
        calls.push([indexer, from, to]);
        return businessDaysBetween(from, addDays(to, 1)).map((date) => ({ date, dailyRatePercent: "0.05" }));
      },
    };
    expect(await ensureIndexRates(db, provider, userId)).toEqual([]); // sem títulos: nada a buscar
    const a = await createFixedIncomeAsset(db, userId, { name: "CDB", productType: "CDB", indexer: "CDI", rate: "100" });
    await addFixedIncomeMovement(db, userId, a.id, { type: "DEPOSIT", date: "2026-10-01", amount: "100" });
    const r = await ensureIndexRates(db, provider, userId);
    expect(r).toMatchObject([{ indexer: "CDI", status: "SUCCESS" }]);
    expect(calls[0][0]).toBe("CDI");
    expect(calls[0][1]).toBe("2026-09-21");
    expect(await ensureIndexRates(db, null, userId)).toEqual([]);
    const slow: IndexRateProvider = { ...provider, getDailyRates: () => new Promise(() => {}) };
    // Garante que haja algo a buscar (independe de hoje ser dia útil ou feriado)
    // e que a última tentativa foi há 10 min (o "forçar" respeita 2 min).
    await db.indexDailyRate.deleteMany({ where: { date: { gte: fromIso(addDays(todayIsoDate(), -7)) } } });
    await db.indexSyncStatus.updateMany({ data: { lastAttemptAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await ensureIndexRates(db, slow, userId, { force: true, budgetMs: 50 })).toEqual([]); // não trava a tela
  });
});

describe("visão geral: patrimônio por classe de ativo", () => {
  it("total = FIIs (valor de mercado) + renda fixa (bruto estimado); arquivados fora; isolado por usuário", async () => {
    const { getOverview } = await import("@/server/services/overview/overview-service");
    await createFund(db, userId, { ticker: "MXRF11" }, { initialBalance: { quantity: "10", averagePrice: "10" }, quote: { price: "10.50" } });
    const a = await createFixedIncomeAsset(db, userId, { name: "Caixinha Turbo", issuer: "Nubank", productType: "CDB", indexer: "CDI", rate: "115" });
    await addFixedIncomeMovement(db, userId, a.id, { type: "DEPOSIT", date: "2025-03-10", amount: "91" });
    const archived = await createFixedIncomeAsset(db, userId, { name: "Antigo", productType: "CDB", indexer: "CDI", rate: "100" });
    await addFixedIncomeMovement(db, userId, archived.id, { type: "DEPOSIT", date: "2025-03-10", amount: "1000" });
    await setFixedIncomeAssetArchived(db, userId, archived.id, true);

    const o = await getOverview(db, userId, { todayIso: "2025-06-02" });
    const rf = o.fixedIncome.totals.gross;
    expect(rf.gt(91)).toBe(true); // rendeu com as taxas do cache
    expect(o.patrimony.total?.toFixed(10)).toBe(rf.plus("105").toFixed(10));
    expect(o.patrimony.classes.map((c) => c.key)).toEqual(["FII", "FIXED_INCOME"]);
    expect(o.patrimony.classes[0].value?.toFixed(2)).toBe("105.00");
    const shares = o.patrimony.classes.reduce((s, c) => s.plus(c.share!), rf.minus(rf));
    expect(shares.toFixed(10)).toBe("1.0000000000");

    // Fundo sem cotação: total indisponível, renda fixa continua visível.
    await createFund(db, userId, { ticker: "HGLG11" }, { initialBalance: { quantity: "1", averagePrice: "150" } });
    const incomplete = await getOverview(db, userId, { todayIso: "2025-06-02" });
    expect(incomplete.patrimony.total).toBeNull();
    expect(incomplete.patrimony.classes.find((c) => c.key === "FIXED_INCOME")?.value?.eq(rf)).toBe(true);

    // Outro usuário só com renda fixa.
    const other = await createUser(db, { email: "so-rf@teste.dev", name: "RF", password: "SenhaForte123" });
    const b = await createFixedIncomeAsset(db, other.id, { name: "LCI", productType: "LCI", indexer: "CDI", rate: "90" });
    await addFixedIncomeMovement(db, other.id, b.id, { type: "DEPOSIT", date: "2025-06-02", amount: "50" });
    const ob = await getOverview(db, other.id, { todayIso: "2025-06-02" });
    expect(ob.patrimony.total?.toFixed(2)).toBe("50.00");
    expect(ob.patrimony.classes.map((c) => c.key)).toEqual(["FIXED_INCOME"]);
  });
});
