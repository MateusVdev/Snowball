import { describe, expect, it } from "vitest";
import { fixedIncomeAssetSchema, fixedIncomeMovementSchema } from "@/validation/fixed-income";

const base = { name: "Caixinha Turbo", issuer: "Nubank", productType: "CDB", indexer: "CDI", rate: "115" } as const;

describe("validação de renda fixa", () => {
  it("aceita a Caixinha Turbo (CDB 115% do CDI, não isento, liquidez diária)", () => {
    const v = fixedIncomeAssetSchema.parse(base);
    expect(v).toMatchObject({ rate: "115", taxExempt: false, dailyLiquidity: true, spreadAnnualPercent: null, maturityDate: null });
  });

  it("LCI/LCA isentas por padrão; editável", () => {
    expect(fixedIncomeAssetSchema.parse({ ...base, productType: "LCI" }).taxExempt).toBe(true);
    expect(fixedIncomeAssetSchema.parse({ ...base, productType: "LCA" }).taxExempt).toBe(true);
    expect(fixedIncomeAssetSchema.parse({ ...base, productType: "LCA", taxExempt: false }).taxExempt).toBe(false);
    expect(fixedIncomeAssetSchema.parse({ ...base, taxExempt: "on" }).taxExempt).toBe(true);
  });

  it("aceita % com vírgula e spread negativo", () => {
    const v = fixedIncomeAssetSchema.parse({ ...base, productType: "TESOURO_SELIC", indexer: "SELIC", rate: "100", spreadAnnualPercent: "-0,0150" });
    expect(v.spreadAnnualPercent).toBe("-0.015");
    expect(fixedIncomeAssetSchema.parse({ ...base, rate: "102,5" }).rate).toBe("102.5");
  });

  it("recusa combinações inválidas e tipos da fase 2", () => {
    expect(fixedIncomeAssetSchema.safeParse({ ...base, productType: "TESOURO_SELIC" }).success).toBe(false);
    expect(fixedIncomeAssetSchema.safeParse({ ...base, productType: "PREFIXADO" }).success).toBe(false);
    expect(fixedIncomeAssetSchema.safeParse({ ...base, indexer: "IPCA" }).success).toBe(false);
    expect(fixedIncomeAssetSchema.safeParse({ ...base, rate: "0" }).success).toBe(false);
    expect(fixedIncomeAssetSchema.safeParse({ ...base, name: " " }).success).toBe(false);
    expect(fixedIncomeAssetSchema.safeParse({ ...base, maturityDate: "2026-02-30" }).success).toBe(false);
  });

  it("movimentos: valor positivo com até 2 casas, data não futura", () => {
    expect(fixedIncomeMovementSchema.parse({ type: "WITHDRAWAL", date: "2025-03-10", amount: "91,00" }).amount).toBe("91");
    expect(fixedIncomeMovementSchema.safeParse({ type: "DEPOSIT", date: "2025-03-10", amount: "0" }).success).toBe(false);
    expect(fixedIncomeMovementSchema.safeParse({ type: "DEPOSIT", date: "2025-03-10", amount: "1.001" }).success).toBe(false);
    expect(fixedIncomeMovementSchema.safeParse({ type: "DEPOSIT", date: "2999-01-01", amount: "1" }).success).toBe(false);
  });
});
