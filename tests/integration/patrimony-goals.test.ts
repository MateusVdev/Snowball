import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/server/auth/service";
import { businessDaysBetween, fromIso } from "@/domain/fixed-income/calendar";
import { example96Config } from "@/domain/simulation";
import { monthsToReachTotal, projectPatrimony } from "@/domain/portfolio/patrimony-projection";
import { exportBackup, restoreBackup } from "@/server/export/backup";
import { addFixedIncomeMovement, createFixedIncomeAsset } from "@/server/services/fixed-income/fixed-income-service";
import { getFixedIncomeSimulation, saveFixedIncomeSimulation, deleteFixedIncomeSimulation } from "@/server/services/fixed-income/simulation-service";
import { createGoal, listGoalStatuses, updateGoal } from "@/server/services/goals/goal-service";
import { getOverview } from "@/server/services/overview/overview-service";
import { buildPatrimonyProjection } from "@/server/services/patrimony/patrimony-projection-service";
import { createFund } from "@/server/services/portfolio/fund-service";
import { createSimulation, getSimulation } from "@/server/services/simulation/simulation-service";
import { createTestDb, resetDatabase } from "../support/db";

const db = createTestDb();
let userId: string;
let otherId: string;
const TODAY = "2025-06-02";

beforeEach(async () => {
  await resetDatabase(db);
  userId = (await createUser(db, { email: "pat@teste.dev", name: "Pat", password: "SenhaForte123" })).id;
  otherId = (await createUser(db, { email: "outro@teste.dev", name: "Outro", password: "SenhaForte123" })).id;
  await db.indexDailyRate.createMany({
    data: businessDaysBetween("2025-01-01", "2025-12-31").map((d) => ({ indexer: "CDI" as const, date: fromIso(d), dailyRatePercent: "0.05" })),
  });
});
afterAll(async () => db.$disconnect());

const rfParams = { initialAmount: "1000", monthlyContribution: "500", termValue: "24", termUnit: "MONTHS", rateMode: "CDI_PERCENT", cdiPercent: "100", cdiAnnualPercent: "12", startDate: "2025-06-02" } as const;

async function seedPortfolio(owner = userId) {
  await createFund(db, owner, { ticker: "MXRF11" }, { initialBalance: { quantity: "100", averagePrice: "10" }, quote: { price: "10" } });
  const a = await createFixedIncomeAsset(db, owner, { name: "Caixinha", productType: "CDB", indexer: "CDI", rate: "115" });
  await addFixedIncomeMovement(db, owner, a.id, { type: "DEPOSIT", date: "2025-03-10", amount: "500" });
}

describe("metas de patrimônio", () => {
  it("meta antiga 'Patrimônio' continua só FIIs; a nova 'Patrimônio total' soma a renda fixa", async () => {
    await seedPortfolio();
    await createGoal(db, userId, { name: "Antiga", metric: "PATRIMONY", target: "5000" });
    await createGoal(db, userId, { name: "Total", metric: "TOTAL_PATRIMONY", target: "5000" });
    const o = await getOverview(db, userId, { todayIso: TODAY });
    const [old, total] = await listGoalStatuses(db, userId, o);
    expect(old.current?.toFixed(2)).toBe("1000.00");
    expect(old.currentNote).toContain("não inclui renda fixa");
    const rf = o.fixedIncome.totals.gross;
    expect(rf.gt(500)).toBe(true);
    expect(total.current?.toFixed(10)).toBe(rf.plus(1000).toFixed(10));
    expect(total.current?.eq(o.patrimony.total!)).toBe(true);
    expect(total.metric).toBe("TOTAL_PATRIMONY");
  });

  it("estimativa: soma da simulação de FIIs e da de renda fixa; ligação só nas metas de patrimônio total", async () => {
    const fii = await createSimulation(db, userId, { name: "96 cotas" }, example96Config(24));
    const rfId = await saveFixedIncomeSimulation(db, userId, { name: "RF 500/mês", params: rfParams });
    const goal = await createGoal(db, userId, { name: "Total", metric: "TOTAL_PATRIMONY", target: "9000", simulationId: fii.id, fixedIncomeSimulationId: rfId });
    expect(goal.fixedIncomeSimulationId).toBe(rfId);

    const fiiSim = (await getSimulation(db, userId, fii.id))!;
    const rfSim = await getFixedIncomeSimulation(db, userId, rfId);
    const expected = monthsToReachTotal("9000", projectPatrimony([
      { key: "FII", source: "a", values: fiiSim.result.months.map((m) => m.patrimony) },
      { key: "FIXED_INCOME", source: "b", values: rfSim.result.rows.map((r) => r.gross) },
    ]));
    expect(expected).not.toBeNull();
    const [status] = await listGoalStatuses(db, userId, await getOverview(db, userId, { todayIso: TODAY }));
    expect(status.estimate?.months).toBe(expected);
    expect(status.estimate?.note).toContain("“96 cotas” + “RF 500/mês”");
    expect(status.fixedIncomeSimulation?.name).toBe("RF 500/mês");

    // Em outros tipos de meta a ligação com renda fixa é ignorada.
    const income = await createGoal(db, userId, { name: "Renda", metric: "MONTHLY_INCOME", target: "10", fixedIncomeSimulationId: rfId });
    expect(income.fixedIncomeSimulationId).toBeNull();

    // Excluir a simulação de renda fixa só desfaz a ligação (a meta continua).
    await deleteFixedIncomeSimulation(db, userId, rfId);
    expect((await db.financialGoal.findUniqueOrThrow({ where: { id: goal.id } })).fixedIncomeSimulationId).toBeNull();
  });

  it("isolamento: não dá para vincular nem usar simulações de outro usuário", async () => {
    const theirs = await saveFixedIncomeSimulation(db, otherId, { name: "Deles", params: rfParams });
    await expect(createGoal(db, userId, { name: "x", metric: "TOTAL_PATRIMONY", target: "1", fixedIncomeSimulationId: theirs })).rejects.toMatchObject({ code: "INVALID" });
    const mine = await createGoal(db, userId, { name: "x", metric: "TOTAL_PATRIMONY", target: "1" });
    await expect(updateGoal(db, userId, mine.id, { name: "x", metric: "TOTAL_PATRIMONY", target: "1", fixedIncomeSimulationId: theirs })).rejects.toMatchObject({ code: "INVALID" });
    await expect(buildPatrimonyProjection(db, userId, { fixedIncomeSimulationId: theirs })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(buildPatrimonyProjection(db, userId, {})).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("simulação do patrimônio total a partir das simulações salvas", () => {
  it("FIIs + renda fixa até o prazo mais curto, com total líquido", async () => {
    const fii = await createSimulation(db, userId, { name: "FIIs 12m" }, example96Config(12));
    const rfId = await saveFixedIncomeSimulation(db, userId, { name: "RF 24m", params: rfParams });
    const v = await buildPatrimonyProjection(db, userId, { fiiSimulationId: fii.id, fixedIncomeSimulationId: rfId });
    expect(v.projection.months).toHaveLength(12);
    expect(v.projection.truncated).toBe(true);
    const m1 = v.projection.months[0];
    expect(m1.total.eq(m1.byClass.FII!.plus(m1.byClass.FIXED_INCOME!))).toBe(true);
    expect(v.netTotals[0].lt(m1.total)).toBe(true); // renda fixa líquida < bruta
    const onlyRf = await buildPatrimonyProjection(db, userId, { fixedIncomeSimulationId: rfId });
    expect(onlyRf.projection.months).toHaveLength(24);
    expect(onlyRf.projection.classes.map((c) => c.key)).toEqual(["FIXED_INCOME"]);
  });
});

describe("backup e restauração", () => {
  it("meta de patrimônio total e ligação com a simulação de renda fixa voltam remapeadas; backup antigo continua válido", async () => {
    const fii = await createSimulation(db, userId, { name: "FIIs" }, example96Config(12));
    const rfId = await saveFixedIncomeSimulation(db, userId, { name: "RF", params: rfParams });
    await createGoal(db, userId, { name: "Total", metric: "TOTAL_PATRIMONY", target: "9000", simulationId: fii.id, fixedIncomeSimulationId: rfId });
    await createGoal(db, userId, { name: "Antiga", metric: "PATRIMONY", target: "5000" });
    const backup = JSON.parse(JSON.stringify(await exportBackup(db, userId)));

    const fresh = await createUser(db, { email: "novo@teste.dev", name: "Novo", password: "SenhaForte123" });
    await restoreBackup(db, fresh.id, backup);
    const goals = await db.financialGoal.findMany({ where: { userId: fresh.id }, orderBy: { createdAt: "asc" } });
    const total = goals.find((g) => g.name === "Total")!;
    const restoredRf = await db.fixedIncomeSimulation.findFirstOrThrow({ where: { userId: fresh.id } });
    expect(total.metric).toBe("TOTAL_PATRIMONY");
    expect(total.fixedIncomeSimulationId).toBe(restoredRf.id);
    expect(goals.find((g) => g.name === "Antiga")).toMatchObject({ metric: "PATRIMONY", fixedIncomeSimulationId: null });

    // Backup de antes desta funcionalidade (metas sem o campo novo).
    const old = structuredClone(backup);
    old.data.goals = old.data.goals.filter((g: { metric: string }) => g.metric !== "TOTAL_PATRIMONY").map((g: Record<string, unknown>) => {
      const copy = { ...g };
      delete copy.fixedIncomeSimulationId;
      return copy;
    });
    old.checksum = createHash("sha256").update(JSON.stringify(old.data)).digest("hex");
    const third = await createUser(db, { email: "velho@teste.dev", name: "Velho", password: "SenhaForte123" });
    await restoreBackup(db, third.id, old);
    expect(await db.financialGoal.findFirst({ where: { userId: third.id } })).toMatchObject({ metric: "PATRIMONY", fixedIncomeSimulationId: null });
  });
});
