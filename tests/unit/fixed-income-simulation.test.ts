import { describe, expect, it } from "vitest";
import { businessDaysBetween, calendarDaysBetween } from "@/domain/fixed-income/calendar";
import {
  addMonths,
  annualToDailyPercent,
  dailyToAnnualPercent,
  nextBusinessDay,
  simulateFixedIncome,
  SimulationError,
  type FixedIncomeSimulationParams,
} from "@/domain/fixed-income/simulation";
import { incomeTaxRate, iofRate } from "@/domain/fixed-income/taxes";
import { FinDecimal } from "@/domain/money";
import { fixedIncomeSimulationSchema } from "@/validation/fixed-income-simulation";

const base: FixedIncomeSimulationParams = {
  initialAmount: "1000", monthlyContribution: "0", months: 12, rateMode: "CDI_PERCENT", cdiPercent: "100",
  annualRatePercent: null, cdiAnnualPercent: "12", taxExempt: false, startDate: "2026-01-05",
};
const close = (a: FinDecimal, b: FinDecimal | string, digits = 15) =>
  expect(a.minus(b).abs().lt(new FinDecimal(10).pow(-digits))).toBe(true);

/** Cálculo independente: cada aporte rende (1 + d)^(dias úteis) e paga IR/IOF pelo próprio prazo. */
function independent(deposits: { date: string; amount: string }[], end: string, dailyFactor: FinDecimal, exempt = false) {
  let gross = new FinDecimal(0);
  let tax = new FinDecimal(0);
  for (const d of deposits) {
    const g = new FinDecimal(d.amount).times(dailyFactor.pow(businessDaysBetween(d.date, end).length));
    const y = g.minus(d.amount);
    const days = calendarDaysBetween(d.date, end);
    const iof = y.times(iofRate(days));
    gross = gross.plus(g);
    tax = tax.plus(iof).plus(exempt ? 0 : y.minus(iof).times(incomeTaxRate(days)));
  }
  return { gross, tax, net: gross.minus(tax) };
}

describe("conversões e datas", () => {
  it("CDI anual ↔ taxa diária (252 dias úteis)", () => {
    close(annualToDailyPercent("14.9"), "0.055131064154026009386097310982220787200", 30);
    expect(dailyToAnnualPercent("0.055131").toDecimalPlaces(2).toFixed()).toBe("14.9");
    close(dailyToAnnualPercent(annualToDailyPercent("12.34")), "12.34", 30);
  });

  it("mês seguinte (fim de mês) e próximo dia útil (feriado)", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-20", 2)).toBe("2027-01-20");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(nextBusinessDay("2026-11-20")).toBe("2026-11-23"); // Consciência Negra (sexta)
    expect(nextBusinessDay("2026-11-23")).toBe("2026-11-23");
  });
});

describe("simulação", () => {
  it("valor inicial sem aportes: bate com o cálculo direto por dias úteis", () => {
    const r = simulateFixedIncome({ ...base, months: 1 });
    const f = new FinDecimal(1).plus(annualToDailyPercent("12").dividedBy(100));
    const exp = independent([{ date: "2026-01-05", amount: "1000" }], "2026-02-05", f);
    close(r.summary.gross, exp.gross);
    close(r.summary.net, exp.net);
    expect(r.rows).toHaveLength(1);
  });

  it("aporte mensal: no início de cada mês; total aplicado = inicial + meses × aporte", () => {
    const r = simulateFixedIncome({ ...base, monthlyContribution: "100" });
    expect(r.rows).toHaveLength(12);
    expect(r.summary.totalApplied.toFixed()).toBe("2200");
    expect(r.rows[0].contribution.toFixed()).toBe("1100"); // inicial + aporte do mês 1
    expect(r.rows.slice(1).every((m) => m.contribution.toFixed() === "100")).toBe(true);
    // soma dos rendimentos mensais = rendimento acumulado
    const sum = r.rows.reduce((a, m) => a.plus(m.earnings), new FinDecimal(0));
    close(sum, r.summary.gross.minus(r.summary.totalApplied));
    // cada mês cresce
    for (let i = 1; i < r.rows.length; i++) expect(r.rows[i].gross.gt(r.rows[i - 1].gross)).toBe(true);
  });

  it("IR regressivo POR APORTE: o inicial já está em 15% e os últimos em 22,5% (soma igual ao cálculo independente)", () => {
    const params = { ...base, monthlyContribution: "200", months: 30, cdiPercent: "115", cdiAnnualPercent: "14.9" };
    const r = simulateFixedIncome(params);
    const f = new FinDecimal(1).plus(annualToDailyPercent("14.9").dividedBy(100).times("1.15"));
    const end = addMonths(base.startDate, 30);
    const deposits = [{ date: base.startDate, amount: "1000" }, ...Array.from({ length: 30 }, (_, k) => ({ date: nextBusinessDay(addMonths(base.startDate, k)), amount: "200" }))];
    const exp = independent(deposits, end, f);
    close(r.summary.gross, exp.gross, 12);
    close(r.summary.incomeTax.plus(r.summary.iof), exp.tax, 12);
    expect(incomeTaxRate(calendarDaysBetween(base.startDate, end)).toFixed()).toBe("0.15");
    expect(incomeTaxRate(calendarDaysBetween(deposits.at(-1)!.date, end)).toFixed()).toBe("0.225");
    // a alíquota efetiva fica entre 15% e 22,5%
    const effective = r.summary.incomeTax.dividedBy(r.summary.gross.minus(r.summary.totalApplied).minus(r.summary.iof));
    expect(effective.gt("0.15") && effective.lt("0.225")).toBe(true);
  });

  it("aporte que cai em feriado vai para o próximo dia útil", () => {
    // início 20/10/2026 → aporte do mês 2 seria 20/11 (feriado) → 23/11
    const params = { ...base, initialAmount: "0", monthlyContribution: "100", months: 2, startDate: "2026-10-20" };
    const r = simulateFixedIncome(params);
    const f = new FinDecimal(1).plus(annualToDailyPercent("12").dividedBy(100));
    const exp = independent([{ date: "2026-10-20", amount: "100" }, { date: "2026-11-23", amount: "100" }], "2026-12-20", f);
    close(r.summary.gross, exp.gross);
  });

  it("CDI editável: CDI maior rende mais; % do CDI multiplica a taxa", () => {
    const low = simulateFixedIncome({ ...base, cdiAnnualPercent: "10" });
    const high = simulateFixedIncome({ ...base, cdiAnnualPercent: "15" });
    expect(high.summary.net.gt(low.summary.net)).toBe(true);
    const p115 = simulateFixedIncome({ ...base, cdiPercent: "115" });
    expect(p115.summary.gross.gt(simulateFixedIncome(base).summary.gross)).toBe(true);
    close(p115.summary.dailyRatePercent, annualToDailyPercent("12"), 30);
  });

  it("taxa anual fixa = 100% de um CDI igual à taxa", () => {
    const fixed = simulateFixedIncome({ ...base, rateMode: "ANNUAL_FIXED", annualRatePercent: "12", cdiPercent: null, cdiAnnualPercent: null, monthlyContribution: "50" });
    const cdi = simulateFixedIncome({ ...base, monthlyContribution: "50" });
    close(fixed.summary.net, cdi.summary.net, 25);
  });

  it("isento de IR (selecionável): IR zero e líquido maior", () => {
    const params = { ...base, months: 24, monthlyContribution: "100" };
    const exempt = simulateFixedIncome({ ...params, taxExempt: true });
    expect(exempt.summary.incomeTax.isZero()).toBe(true);
    expect(exempt.summary.net.gt(simulateFixedIncome(params).summary.net)).toBe(true);
  });

  it("valida entradas", () => {
    expect(() => simulateFixedIncome({ ...base, months: 361 })).toThrow(SimulationError);
    expect(() => simulateFixedIncome({ ...base, initialAmount: "0" })).toThrow(SimulationError);
    expect(() => simulateFixedIncome({ ...base, cdiAnnualPercent: null })).toThrow(/CDI anual/);
  });
});

describe("parâmetros do formulário", () => {
  const form = { initialAmount: "1.000,50", monthlyContribution: "", termValue: "5", termUnit: "YEARS", rateMode: "CDI_PERCENT", cdiPercent: "115", cdiAnnualPercent: "14,9", startDate: "2026-11-20" };
  it("aceita vírgula, anos viram meses, aporte vazio = 0, isenção selecionável", () => {
    const c = fixedIncomeSimulationSchema.parse(form);
    expect(c).toMatchObject({ initialAmount: "1000.5", monthlyContribution: "0", months: 60, cdiAnnualPercent: "14.9", taxExempt: false });
    expect(fixedIncomeSimulationSchema.parse({ ...form, taxExempt: "on" }).taxExempt).toBe(true);
  });
  it("erros nos campos certos", () => {
    const err = (v: object) => fixedIncomeSimulationSchema.safeParse({ ...form, ...v }).error?.issues.map((i) => i.path.join("."));
    expect(err({ termValue: "31" })).toContain("termValue");
    expect(err({ cdiAnnualPercent: "" })).toContain("cdiAnnualPercent");
    expect(err({ rateMode: "ANNUAL_FIXED" })).toContain("annualRatePercent");
    expect(err({ initialAmount: "0" })).toContain("initialAmount");
  });
});
