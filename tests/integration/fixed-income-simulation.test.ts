import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/server/auth/service";
import { addDays, businessDaysBetween, fromIso } from "@/domain/fixed-income/calendar";
import { exportBackup, restoreBackup } from "@/server/export/backup";
import { buildDataset } from "@/server/export/datasets";
import type { IndexRateProvider } from "@/server/integrations/types";
import { addFixedIncomeMovement, createFixedIncomeAsset } from "@/server/services/fixed-income/fixed-income-service";
import {
  currentCdi,
  deleteFixedIncomeSimulation,
  getFixedIncomeSimulation,
  listFixedIncomeSimulations,
  saveFixedIncomeSimulation,
  simulatorDefaults,
} from "@/server/services/fixed-income/simulation-service";
import { createTestDb, resetDatabase } from "../support/db";

const db = createTestDb();
let userId: string;
let otherId: string;

beforeEach(async () => {
  await resetDatabase(db);
  userId = (await createUser(db, { email: "sim@teste.dev", name: "Sim", password: "SenhaForte123" })).id;
  otherId = (await createUser(db, { email: "outro@teste.dev", name: "Outro", password: "SenhaForte123" })).id;
});
afterAll(async () => db.$disconnect());

const params = {
  initialAmount: "1000", monthlyContribution: "200", termValue: "2", termUnit: "YEARS", rateMode: "CDI_PERCENT",
  cdiPercent: "115", cdiAnnualPercent: "14,9", startDate: "2026-11-20",
} as const;

describe("valores pré-preenchidos", () => {
  it("valor inicial = saldo bruto da renda fixa; CDI atual = última taxa anualizada", async () => {
    await db.indexDailyRate.createMany({
      data: businessDaysBetween("2026-10-01", "2026-11-20").map((d) => ({ indexer: "CDI" as const, date: fromIso(d), dailyRatePercent: "0.055131" })),
    });
    const a = await createFixedIncomeAsset(db, userId, { name: "Caixinha", productType: "CDB", indexer: "CDI", rate: "115" });
    await addFixedIncomeMovement(db, userId, a.id, { type: "DEPOSIT", date: "2026-11-03", amount: "91" });
    const d = await simulatorDefaults(db, userId, null);
    expect(Number(d.initialAmount)).toBeGreaterThan(91); // já rendeu
    expect(d.cdi).toMatchObject({ annualPercent: "14.90", dailyPercent: "0.055131" });
    expect((await simulatorDefaults(db, otherId, null)).initialAmount).toBe("0.00"); // isolado
  });

  it("sem CDI guardado: busca os últimos dias no Banco Central (simulado); sem provedor, null", async () => {
    expect(await currentCdi(db, null, { today: "2026-11-19" })).toBeNull();
    const provider: IndexRateProvider = {
      id: "BCB",
      name: "Banco Central (simulado)",
      async getDailyRates(_i, from, to) {
        return businessDaysBetween(from, addDays(to, 1)).map((date) => ({ date, dailyRatePercent: "0.05" }));
      },
    };
    const cdi = await currentCdi(db, provider, { today: "2026-11-19" });
    expect(cdi).toMatchObject({ annualPercent: "13.42", date: "2026-11-19" });
  });
});

describe("simulações salvas", () => {
  it("salvar, listar, abrir, atualizar e excluir — com auditoria e isolamento por usuário", async () => {
    const id = await saveFixedIncomeSimulation(db, userId, { name: "Caixinha + 200", params });
    const list = await listFixedIncomeSimulations(db, userId);
    expect(list).toHaveLength(1);
    expect(list[0].summary).toMatchObject({ months: 24, totalApplied: "5800.00" });

    const opened = await getFixedIncomeSimulation(db, userId, id);
    expect(opened.config).toMatchObject({ months: 24, cdiAnnualPercent: "14.9", taxExempt: false, startDate: "2026-11-20" });
    expect(opened.result.summary.totalApplied.toFixed()).toBe("5800");

    await saveFixedIncomeSimulation(db, userId, { id, name: "Caixinha isenta", params: { ...params, taxExempt: "on" } });
    const updated = await getFixedIncomeSimulation(db, userId, id);
    expect(updated.simulation.name).toBe("Caixinha isenta");
    expect(updated.result.summary.incomeTax.isZero()).toBe(true);
    expect(await db.fixedIncomeSimulation.count()).toBe(1);

    // Outro usuário não vê, não abre, não altera e não exclui.
    expect(await listFixedIncomeSimulations(db, otherId)).toHaveLength(0);
    await expect(getFixedIncomeSimulation(db, otherId, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveFixedIncomeSimulation(db, otherId, { id, name: "x", params })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteFixedIncomeSimulation(db, otherId, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await buildDataset(db, otherId, "simulacoes-renda-fixa")).rows).toHaveLength(0);
    expect((await buildDataset(db, userId, "simulacoes-renda-fixa")).rows).toHaveLength(1);

    await deleteFixedIncomeSimulation(db, userId, id);
    expect(await db.fixedIncomeSimulation.count()).toBe(0);
    const actions = (await db.auditEvent.findMany({ where: { entityType: "fixed_income_simulation" }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["create", "update", "delete"]);
  });

  it("parâmetros inválidos não são salvos", async () => {
    await expect(saveFixedIncomeSimulation(db, userId, { name: "x", params: { ...params, cdiAnnualPercent: "" } })).rejects.toThrow();
    await expect(saveFixedIncomeSimulation(db, userId, { name: " ", params })).rejects.toThrow();
    expect(await db.fixedIncomeSimulation.count()).toBe(0);
  });
});

describe("backup e restauração", () => {
  it("simulações de renda fixa vão no backup e voltam com o mesmo resultado; backup antigo continua válido", async () => {
    const id = await saveFixedIncomeSimulation(db, userId, { name: "Plano 2 anos", params });
    const backup = JSON.parse(JSON.stringify(await exportBackup(db, userId)));
    expect(backup.data.fixedIncomeSimulations).toHaveLength(1);

    const fresh = await createUser(db, { email: "novo@teste.dev", name: "Novo", password: "SenhaForte123" });
    const r = await restoreBackup(db, fresh.id, backup);
    expect(r.fixedIncomeSimulations).toBe(1);
    const [restored] = await listFixedIncomeSimulations(db, fresh.id);
    expect(restored.id).not.toBe(id);
    const a = await getFixedIncomeSimulation(db, userId, id);
    const b = await getFixedIncomeSimulation(db, fresh.id, restored.id);
    expect(b.result.summary.net.toFixed(10)).toBe(a.result.summary.net.toFixed(10));

    // Conta que já tem simulação de renda fixa conta como "com dados".
    await expect(restoreBackup(db, fresh.id, backup)).rejects.toThrow(/sem dados/);

    // Backup anterior a esta funcionalidade (sem o campo) continua aceito.
    const old = structuredClone(backup);
    delete old.data.fixedIncomeSimulations;
    old.checksum = createHash("sha256").update(JSON.stringify(old.data)).digest("hex");
    const third = await createUser(db, { email: "velho@teste.dev", name: "Velho", password: "SenhaForte123" });
    expect((await restoreBackup(db, third.id, old)).fixedIncomeSimulations).toBe(0);

    // Simulação inválida no backup: recusado sem gravar nada.
    const bad = structuredClone(backup);
    bad.data.fixedIncomeSimulations[0].config.termValue = 999;
    bad.checksum = createHash("sha256").update(JSON.stringify(bad.data)).digest("hex");
    const fourth = await createUser(db, { email: "quarto@teste.dev", name: "Q", password: "SenhaForte123" });
    await expect(restoreBackup(db, fourth.id, bad)).rejects.toThrow(/inválida/);
    expect(await db.fixedIncomeSimulation.count({ where: { userId: fourth.id } })).toBe(0);
  });
});
