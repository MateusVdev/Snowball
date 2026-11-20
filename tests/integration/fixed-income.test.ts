import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/server/auth/service";
import { addDays, businessDaysBetween, fromIso } from "@/domain/fixed-income/calendar";
import { computeFixedIncome } from "@/domain/fixed-income/engine";
import { FinDecimal } from "@/domain/money";
import { ProviderError } from "@/server/integrations/errors";
import type { IndexDailyRateData, IndexRateProvider } from "@/server/integrations/types";
import {
  addFixedIncomeMovement,
  createFixedIncomeAsset,
  deleteFixedIncomeMovement,
  getFixedIncomeAsset,
  listFixedIncomeAssets,
  setFixedIncomeAssetArchived,
  updateFixedIncomeAsset,
  updateFixedIncomeMovement,
} from "@/server/services/fixed-income/fixed-income-service";
import { getIndexStatus, loadIndexRates, syncIndexRates } from "@/server/services/fixed-income/index-rate-service";
import { ServiceError } from "@/server/services/errors";
import { createTestDb, resetDatabase } from "../support/db";

/** Provedor de índices FALSO — usado somente nestes testes. */
function fakeIndexProvider(impl: (indexer: "CDI" | "SELIC", from: string, to: string) => Promise<IndexDailyRateData[]>) {
  const calls: [string, string, string][] = [];
  const provider: IndexRateProvider = {
    id: "BCB",
    name: "Banco Central (simulado)",
    async getDailyRates(indexer, from, to) {
      calls.push([indexer, from, to]);
      return impl(indexer, from, to);
    },
  };
  return { provider, calls };
}

/** Taxa fixa em todos os dias úteis de [from, to] (inclusive). */
const fixedRates = (from: string, to: string, pct = "0.04") =>
  businessDaysBetween(from, addDays(to, 1)).map((date) => ({ date, dailyRatePercent: pct }));

async function seedRates(indexer: "CDI" | "SELIC", from: string, to: string, pct = "0.04") {
  await db.indexDailyRate.createMany({
    data: fixedRates(from, to, pct).map((r) => ({ indexer, date: fromIso(r.date), dailyRatePercent: r.dailyRatePercent })),
  });
}

const db = createTestDb();
let userId: string;
let otherId: string;

beforeEach(async () => {
  await resetDatabase(db);
  userId = (await createUser(db, { email: "rf@teste.dev", name: "RF", password: "SenhaForte123" })).id;
  otherId = (await createUser(db, { email: "outro@teste.dev", name: "Outro", password: "SenhaForte123" })).id;
});
afterAll(async () => db.$disconnect());

const caixinha = { name: "Caixinha Turbo", issuer: "Nubank", productType: "CDB", indexer: "CDI", rate: "115" } as const;

describe("cache de índices do Banco Central (API simulada)", () => {
  it("sucesso: grava as taxas e o status; busca só o que falta depois", async () => {
    const { provider, calls } = fakeIndexProvider(async (_i, from, to) => fixedRates(from, to, "0.045513"));
    const r1 = await syncIndexRates(db, provider, "CDI", { from: "2025-01-01", to: "2025-01-10" });
    expect(r1).toMatchObject({ status: "SUCCESS", inserted: 7, knownUntil: "2025-01-10" });
    expect(calls).toEqual([["CDI", "2025-01-01", "2025-01-10"]]);
    const status = (await getIndexStatus(db)).find((s) => s.indexer === "CDI")!;
    expect(status).toMatchObject({ knownFrom: "2025-01-02", knownUntil: "2025-01-10", lastError: null });
    expect(status.lastSuccessAt).not.toBeNull();

    // Dentro do intervalo mínimo: não consulta de novo as datas recentes.
    const r2 = await syncIndexRates(db, provider, "CDI", { from: "2025-01-01", to: "2025-01-20" });
    expect(r2.status).toBe("SKIPPED");
    expect(calls).toHaveLength(1);

    // Mais tarde: busca apenas depois da maior data e antes da menor.
    const later = new Date(Date.now() + 2 * 3600_000);
    const r3 = await syncIndexRates(db, provider, "CDI", { from: "2024-12-20", to: "2025-01-20", now: later });
    expect(r3.status).toBe("SUCCESS");
    expect(calls.slice(1)).toEqual([
      ["CDI", "2024-12-20", "2025-01-01"],
      ["CDI", "2025-01-11", "2025-01-20"],
    ]);
    const rates = await loadIndexRates(db, "CDI", "2024-12-01", "2025-01-31");
    expect(rates.get("2025-01-02")).toBe("0.045513");
    expect(rates.has("2025-01-01")).toBe(false); // feriado
  });

  it("falha: mantém o cache, registra o erro e não lança", async () => {
    await seedRates("CDI", "2025-01-02", "2025-01-10");
    const { provider } = fakeIndexProvider(async () => {
      throw new ProviderError("UNAVAILABLE", "Banco Central (SGS)");
    });
    const r = await syncIndexRates(db, provider, "CDI", { from: "2025-01-01", to: "2025-01-20", force: true });
    expect(r).toMatchObject({ status: "FAILED", inserted: 0, knownUntil: "2025-01-10" });
    expect(r.message).toContain("indisponível");
    expect(await db.indexDailyRate.count()).toBe(7);
    const status = await db.indexSyncStatus.findUniqueOrThrow({ where: { indexer: "CDI" } });
    expect(status.lastError).toContain("indisponível");
    expect(status.lastSuccessAt).toBeNull();
  });

  it("resposta vazia: sucesso sem gravar nada", async () => {
    const { provider } = fakeIndexProvider(async () => []);
    const r = await syncIndexRates(db, provider, "SELIC", { from: "2025-01-04", to: "2025-01-05" });
    expect(r).toMatchObject({ status: "SUCCESS", inserted: 0, knownUntil: null });
    expect(await db.indexDailyRate.count()).toBe(0);
  });

  it("não sobrescreve taxas gravadas e respeita integrações desligadas", async () => {
    await seedRates("CDI", "2025-01-02", "2025-01-03", "0.04");
    const { provider } = fakeIndexProvider(async (_i, from, to) => fixedRates(from, to, "0.09"));
    await syncIndexRates(db, provider, "CDI", { from: "2025-01-02", to: "2025-01-08", force: true });
    const rates = await loadIndexRates(db, "CDI", "2025-01-01", "2025-01-31");
    expect(rates.get("2025-01-02")).toBe("0.04");
    expect(rates.get("2025-01-06")).toBe("0.09");

    const disabled = await syncIndexRates(db, null, "CDI", { from: "2020-01-01" });
    expect(disabled.status).toBe("DISABLED");
  });
});

describe("títulos e movimentos", () => {
  it("cadastra a Caixinha Turbo e calcula a posição com o cache de índices", async () => {
    await seedRates("CDI", "2025-01-01", "2025-12-31");
    const asset = await createFixedIncomeAsset(db, userId, caixinha);
    await addFixedIncomeMovement(db, userId, asset.id, { type: "DEPOSIT", date: "2025-03-10", amount: "91" });
    const view = await getFixedIncomeAsset(db, userId, asset.id, "2025-03-24");
    const expected = new FinDecimal(91).times(new FinDecimal("1.00046").pow(10));
    expect(view.result.current.gross.minus(expected).abs().lt("1e-20")).toBe(true);
    expect(view.taxExempt).toBe(false);
    expect(view.movements).toHaveLength(1);
    const audit = await db.auditEvent.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => `${a.entityType}:${a.action}`)).toEqual(["fixed_income_asset:create", "fixed_income_movement:create"]);
  });

  it("resgate informado pelo LÍQUIDO: grava o líquido e calcula o bruto equivalente", async () => {
    await seedRates("CDI", "2024-01-01", "2025-12-31");
    const asset = await createFixedIncomeAsset(db, userId, { ...caixinha, rate: "100" });
    await addFixedIncomeMovement(db, userId, asset.id, { type: "DEPOSIT", date: "2024-01-02", amount: "1000" });
    await addFixedIncomeMovement(db, userId, asset.id, { type: "WITHDRAWAL", date: "2025-03-10", amount: "600" });
    const stored = await db.fixedIncomeMovement.findFirstOrThrow({ where: { type: "WITHDRAWAL" } });
    expect(stored.amount.toString()).toBe("600");
    const view = await getFixedIncomeAsset(db, userId, asset.id, "2025-03-10");
    const w = view.result.withdrawals[0];
    expect(w.gross.minus(w.iof).minus(w.incomeTax).minus(600).abs().lt("1e-20")).toBe(true);
    expect(w.gross.gt(600)).toBe(true);
  });

  it("recusa resgate acima do saldo líquido estimado; aceita diferença dentro da tolerância como resgate total", async () => {
    await seedRates("CDI", "2025-01-01", "2025-12-31");
    const asset = await createFixedIncomeAsset(db, userId, caixinha);
    await addFixedIncomeMovement(db, userId, asset.id, { type: "DEPOSIT", date: "2025-01-02", amount: "1000" });
    const net = (await getFixedIncomeAsset(db, userId, asset.id, "2025-03-10")).result.current.net;

    await expect(
      addFixedIncomeMovement(db, userId, asset.id, { type: "WITHDRAWAL", date: "2025-03-10", amount: net.plus(20).toFixed(2) }),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(await db.fixedIncomeMovement.count()).toBe(1); // nada gravado

    await addFixedIncomeMovement(db, userId, asset.id, { type: "WITHDRAWAL", date: "2025-03-10", amount: net.plus("0.5").toFixed(2) });
    const after = await getFixedIncomeAsset(db, userId, asset.id, "2025-03-10");
    expect(after.result.current.gross.isZero()).toBe(true);

    // Excluir o aporte deixaria o resgate sem saldo: recusado.
    const deposit = await db.fixedIncomeMovement.findFirstOrThrow({ where: { type: "DEPOSIT" } });
    await expect(deleteFixedIncomeMovement(db, userId, deposit.id)).rejects.toBeInstanceOf(ServiceError);
    // Reduzir o aporte também.
    await expect(
      updateFixedIncomeMovement(db, userId, deposit.id, { type: "DEPOSIT", date: "2025-01-02", amount: "500" }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("edita e exclui movimentos com auditoria", async () => {
    await seedRates("CDI", "2025-01-01", "2025-12-31");
    const asset = await createFixedIncomeAsset(db, userId, caixinha);
    const id = await addFixedIncomeMovement(db, userId, asset.id, { type: "DEPOSIT", date: "2025-01-02", amount: "100" });
    await updateFixedIncomeMovement(db, userId, id, { type: "DEPOSIT", date: "2025-01-03", amount: "150" });
    expect((await db.fixedIncomeMovement.findUniqueOrThrow({ where: { id } })).amount.toString()).toBe("150");
    await deleteFixedIncomeMovement(db, userId, id);
    expect(await db.fixedIncomeMovement.count()).toBe(0);
    const actions = (await db.auditEvent.findMany({ where: { entityType: "fixed_income_movement" }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["create", "update", "delete"]);
  });

  it("resumo soma os títulos ativos; arquivados ficam fora", async () => {
    await seedRates("CDI", "2025-01-01", "2025-12-31");
    await seedRates("SELIC", "2025-01-01", "2025-12-31", "0.041");
    const a = await createFixedIncomeAsset(db, userId, caixinha);
    const b = await createFixedIncomeAsset(db, userId, { name: "Tesouro Selic 2029", productType: "TESOURO_SELIC", indexer: "SELIC", rate: "100" });
    const c = await createFixedIncomeAsset(db, userId, { name: "LCA", productType: "LCA", indexer: "CDI", rate: "90" });
    await addFixedIncomeMovement(db, userId, a.id, { type: "DEPOSIT", date: "2025-03-10", amount: "91" });
    await addFixedIncomeMovement(db, userId, b.id, { type: "DEPOSIT", date: "2025-03-10", amount: "1000" });
    await addFixedIncomeMovement(db, userId, c.id, { type: "DEPOSIT", date: "2025-03-10", amount: "500" });
    await setFixedIncomeAssetArchived(db, userId, c.id, true);

    const summary = await listFixedIncomeAssets(db, userId, { asOf: "2025-06-02" });
    expect(summary.assets.map((x) => x.name)).toEqual(["Caixinha Turbo", "Tesouro Selic 2029"]);
    expect(summary.totals.principal.toFixed()).toBe("1091");
    const sumGross = summary.assets.reduce((s, x) => s.plus(x.result.current.gross), new FinDecimal(0));
    expect(summary.totals.gross.eq(sumGross)).toBe(true);
    expect(summary.ratesKnownUntil).toBe("2025-06-02"); // taxas carregadas até a data de cálculo
    expect(summary.hasProjection).toBe(false);
    expect((await listFixedIncomeAssets(db, userId, { includeArchived: true })).assets).toHaveLength(3);

    // Tesouro Selic usa a série da Selic.
    const selic = summary.assets[1].result;
    const expected = computeFixedIncome({
      terms: { rate: "100", spreadAnnualPercent: null, taxExempt: false },
      movements: [{ id: "x", type: "DEPOSIT", date: "2025-03-10", amount: "1000" }],
      rates: new Map(fixedRates("2025-01-01", "2025-12-31", "0.041").map((r) => [r.date, r.dailyRatePercent])),
      asOf: "2025-06-02",
    });
    expect(selic.current.gross.eq(expected.current.gross)).toBe(true);
  });

  it("alterar a taxa revalida os resgates", async () => {
    await seedRates("CDI", "2025-01-01", "2025-12-31");
    const asset = await createFixedIncomeAsset(db, userId, caixinha);
    await addFixedIncomeMovement(db, userId, asset.id, { type: "DEPOSIT", date: "2025-01-02", amount: "1000" });
    const net = (await getFixedIncomeAsset(db, userId, asset.id, "2025-12-01")).result.current.net;
    await addFixedIncomeMovement(db, userId, asset.id, { type: "WITHDRAWAL", date: "2025-12-01", amount: net.toFixed(2, FinDecimal.ROUND_DOWN) });
    await expect(updateFixedIncomeAsset(db, userId, asset.id, { ...caixinha, rate: "50" })).rejects.toMatchObject({ code: "INVALID" });
    expect((await db.fixedIncomeAsset.findUniqueOrThrow({ where: { id: asset.id } })).rate.toString()).toBe("115");
    await updateFixedIncomeAsset(db, userId, asset.id, { ...caixinha, rate: "120", notes: "subiu" });
    expect((await db.fixedIncomeAsset.findUniqueOrThrow({ where: { id: asset.id } })).notes).toBe("subiu");
  });
});

describe("isolamento por usuário", () => {
  it("um usuário não vê nem altera títulos e movimentos de outro", async () => {
    const asset = await createFixedIncomeAsset(db, userId, caixinha);
    const movementId = await addFixedIncomeMovement(db, userId, asset.id, { type: "DEPOSIT", date: "2025-03-10", amount: "91" });

    expect((await listFixedIncomeAssets(db, otherId)).assets).toHaveLength(0);
    await expect(getFixedIncomeAsset(db, otherId, asset.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateFixedIncomeAsset(db, otherId, asset.id, caixinha)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setFixedIncomeAssetArchived(db, otherId, asset.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      addFixedIncomeMovement(db, otherId, asset.id, { type: "DEPOSIT", date: "2025-03-10", amount: "1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateFixedIncomeMovement(db, otherId, movementId, { type: "DEPOSIT", date: "2025-03-10", amount: "1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteFixedIncomeMovement(db, otherId, movementId)).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await db.fixedIncomeMovement.count()).toBe(1);
    expect((await listFixedIncomeAssets(db, userId)).assets).toHaveLength(1);
  });
});
