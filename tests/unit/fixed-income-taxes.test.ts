import { describe, expect, it } from "vitest";
import { FinDecimal } from "@/domain/money";
import { IOF_TABLE, incomeTaxRate, iofRate, taxesOnYield } from "@/domain/fixed-income/taxes";

describe("IR regressivo", () => {
  it.each([
    [1, "0.225"], [180, "0.225"], [181, "0.2"], [360, "0.2"],
    [361, "0.175"], [720, "0.175"], [721, "0.15"], [3000, "0.15"],
  ])("%i dias → %s", (days, rate) => {
    expect(incomeTaxRate(days).toFixed()).toBe(rate);
  });
});

describe("IOF regressivo", () => {
  it.each([
    [0, "1"], [1, "0.96"], [2, "0.93"], [15, "0.5"], [29, "0.03"], [30, "0"], [31, "0"], [365, "0"],
  ])("%i dias → %s", (days, rate) => {
    expect(iofRate(days).toFixed()).toBe(rate);
  });

  it("tabela oficial completa: 30 posições, decrescente", () => {
    expect(IOF_TABLE).toHaveLength(30);
    for (let i = 1; i < IOF_TABLE.length; i++) expect(IOF_TABLE[i]).toBeLessThan(IOF_TABLE[i - 1]);
  });
});

describe("tributos sobre o rendimento", () => {
  it("IOF primeiro, IR sobre o rendimento menos o IOF", () => {
    const { iof, incomeTax } = taxesOnYield(new FinDecimal(100), 15, false);
    expect(iof.toFixed()).toBe("50");
    expect(incomeTax.toFixed()).toBe("11.25"); // (100 − 50) × 22,5%
  });

  it("LCI/LCA (isento) não paga IR, mas o IOF continua estimado", () => {
    expect(taxesOnYield(new FinDecimal(100), 400, true).incomeTax.toFixed()).toBe("0");
    expect(taxesOnYield(new FinDecimal(100), 10, true).iof.toFixed()).toBe("66"); // dia 10 = 66%
  });

  it("sem rendimento, sem tributo", () => {
    const zero = taxesOnYield(new FinDecimal(0), 5, false);
    expect(zero.iof.isZero() && zero.incomeTax.isZero()).toBe(true);
    expect(taxesOnYield(new FinDecimal(-1), 5, false).incomeTax.isZero()).toBe(true);
  });
});
