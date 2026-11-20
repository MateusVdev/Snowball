import { describe, expect, it } from "vitest";
import { addDays, businessDaysBetween } from "@/domain/fixed-income/calendar";
import { computeFixedIncome, type FixedIncomeMovementInput } from "@/domain/fixed-income/engine";
import {
  dailyFactor,
  estimateYield,
  firstDayOfNextMonth,
  lastKnownRate,
  sumYieldEstimates,
  weightedIncomeTaxRate,
} from "@/domain/fixed-income/yield-estimate";
import { FinDecimal } from "@/domain/money";

const rates = (from: string, to: string, pct = "0.05") =>
  new Map(businessDaysBetween(from, addDays(to, 1)).map((d) => [d, pct]));
const terms = (rate: string, taxExempt = false, spread: string | null = null) => ({ rate, taxExempt, spreadAnnualPercent: spread });
const dep = (id: string, date: string, amount: string): FixedIncomeMovementInput => ({ id, type: "DEPOSIT", date, amount });
const close = (a: FinDecimal, b: FinDecimal | string, digits = 18) =>
  expect(a.minus(b).abs().lt(new FinDecimal(10).pow(-digits))).toBe(true);

function run(t: ReturnType<typeof terms>, movements: FixedIncomeMovementInput[], asOf: string, r = rates("2023-01-01", "2026-12-31")) {
  const result = computeFixedIncome({ terms: t, movements, rates: r, asOf });
  return { result, estimate: estimateYield({ terms: t, result, rates: r }) };
}

describe("rendimento por dia útil", () => {
  it("100% e 115% do CDI: saldo bruto × taxa do dia × percentual", () => {
    const a = run(terms("100"), [dep("a", "2026-10-01", "1000")], "2026-11-19");
    close(a.estimate.perBusinessDay.gross, a.result.current.gross.times("0.0005"));
    const b = run(terms("115"), [dep("a", "2026-10-01", "1000")], "2026-11-19");
    close(b.estimate.perBusinessDay.gross, b.result.current.gross.times("0.000575"));
    expect(b.estimate.indexDailyRatePercent?.toFixed()).toBe("0.05");
    expect(b.estimate.rateDate).toBe("2026-11-19");
  });

  it("spread anual entra no fator diário", () => {
    const f = dailyFactor(terms("100", false, "0.1"), "0.05");
    close(f, new FinDecimal("1.0005").times(new FinDecimal("1.001").pow(new FinDecimal(1).dividedBy(252))));
  });

  it("usa a última taxa publicada até a data (fim de semana / ainda não publicada)", () => {
    const r = new Map([["2026-11-12", "0.04"], ["2026-11-13", "0.055131"], ["2026-11-30", "0.1"]]);
    expect(lastKnownRate(r, "2026-11-15")).toEqual({ date: "2026-11-13", rate: new FinDecimal("0.055131") });
    expect(lastKnownRate(r, "2026-11-01")).toBeNull();
  });
});

describe("líquido de IR (alíquota ponderada pelos aportes)", () => {
  it("aportes em faixas diferentes: média ponderada pelo saldo bruto", () => {
    const { result, estimate } = run(terms("100"), [dep("a", "2024-01-02", "1000"), dep("b", "2026-10-01", "3000")], "2026-11-19");
    const [la, lb] = result.openLots;
    const expected = la.gross.times("0.15").plus(lb.gross.times("0.225")).dividedBy(la.gross.plus(lb.gross));
    close(estimate.incomeTaxRate, expected);
    close(estimate.perBusinessDay.net, estimate.perBusinessDay.gross.times(new FinDecimal(1).minus(expected)));
    close(weightedIncomeTaxRate(result, false), expected);
  });

  it("isento (LCI/LCA): líquido = bruto", () => {
    const { estimate } = run(terms("90", true), [dep("a", "2026-10-01", "1000")], "2026-11-19");
    expect(estimate.incomeTaxRate.isZero()).toBe(true);
    close(estimate.perBusinessDay.net, estimate.perBusinessDay.gross);
    close(estimate.monthProjection.net, estimate.monthProjection.gross);
  });
});

describe("mês até hoje e projeção do mês", () => {
  it("dias úteis restantes: novembro/2026 tem feriado em 20/11 (sexta)", () => {
    expect(firstDayOfNextMonth("2026-11-19")).toBe("2026-12-01");
    expect(firstDayOfNextMonth("2026-12-10")).toBe("2027-01-01");
    // 19/11 (qui) + 23 a 27 + 30 = 7 (20/11 é feriado)
    expect(run(terms("100"), [dep("a", "2026-10-01", "1000")], "2026-11-19").estimate.remainingBusinessDays).toBe(7);
    // No feriado: restam 23 a 27 + 30
    expect(run(terms("100"), [dep("a", "2026-10-01", "1000")], "2026-11-20").estimate.remainingBusinessDays).toBe(6);
    // Novembro/2023: 20/11 ainda não era feriado nacional → 17, 20, 21–24, 27–30
    expect(run(terms("100"), [dep("a", "2023-10-02", "1000")], "2023-11-17").estimate.remainingBusinessDays).toBe(10);
    // Sábado no último fim de semana do mês: nada mais rende
    expect(run(terms("100"), [dep("a", "2026-10-01", "1000")], "2026-10-31").estimate.remainingBusinessDays).toBe(0);
  });

  it("projeção = rendido no mês + saldo × (fator^dias restantes − 1); bate com o motor no fim do mês", () => {
    const moves = [dep("a", "2026-10-01", "1000")];
    const { result, estimate } = run(terms("115"), moves, "2026-11-19");
    close(estimate.monthToDate.gross, result.monthEarnings);
    const f = new FinDecimal("1.000575");
    close(estimate.monthProjection.gross, result.monthEarnings.plus(result.current.gross.times(f.pow(7).minus(1))));
    // Com a mesma taxa até o fim do mês, a projeção é exatamente o que o motor calcula em 01/12.
    const end = run(terms("115"), moves, "2026-12-01");
    close(estimate.monthProjection.gross, end.result.months.find((m) => m.month === "2026-11")!.earnings);
  });

  it("mês sem feriado: julho/2026 tem 23 dias úteis", () => {
    const { result, estimate } = run(terms("100"), [dep("a", "2026-06-01", "1000")], "2026-07-01");
    expect(estimate.remainingBusinessDays).toBe(23);
    expect(estimate.monthToDate.gross.isZero()).toBe(true);
    close(estimate.monthProjection.gross, result.current.gross.times(new FinDecimal("1.0005").pow(23).minus(1)));
  });

  it("sem taxa conhecida: indisponível (nada é inventado)", () => {
    const { estimate } = run(terms("100"), [dep("a", "2026-10-01", "1000")], "2026-11-19", new Map());
    expect(estimate.available).toBe(false);
    expect(estimate.perBusinessDay.gross.isZero()).toBe(true);
    expect(estimate.monthProjection.gross.isZero()).toBe(true);
  });

  it("total de vários títulos soma bruto e líquido de cada um", () => {
    const a = run(terms("115"), [dep("a", "2026-10-01", "1000")], "2026-11-19").estimate;
    const b = run(terms("90", true), [dep("b", "2025-01-02", "500")], "2026-11-19").estimate;
    const total = sumYieldEstimates([a, b]);
    close(total.perBusinessDay.gross, a.perBusinessDay.gross.plus(b.perBusinessDay.gross));
    close(total.monthProjection.net, a.monthProjection.net.plus(b.monthProjection.net));
    expect(total.available).toBe(true);
    expect(sumYieldEstimates([]).available).toBe(false);
  });
});
