import { describe, expect, it } from "vitest";
import { businessDaysBetween, calendarDaysBetween } from "@/domain/fixed-income/calendar";
import { computeFixedIncome, FixedIncomeError, type FixedIncomeMovementInput } from "@/domain/fixed-income/engine";
import { FinDecimal } from "@/domain/money";
import { incomeTaxRate } from "@/domain/fixed-income/taxes";

/** Taxa diária fixa (em %) em todos os dias úteis de [from, to). */
function fixedRates(from: string, to: string, pct = "0.05") {
  return new Map(businessDaysBetween(from, to).map((d) => [d, pct]));
}

const terms = (rate: string, taxExempt = false, spread: string | null = null) => ({
  rate,
  taxExempt,
  spreadAnnualPercent: spread,
});
const dep = (id: string, date: string, amount: string, order = 0): FixedIncomeMovementInput => ({ id, type: "DEPOSIT", date, amount, order });
const wd = (id: string, date: string, amount: string, order = 0): FixedIncomeMovementInput => ({ id, type: "WITHDRAWAL", date, amount, order });

const close = (a: FinDecimal, b: string | FinDecimal, digits = 18) =>
  expect(a.minus(b).abs().lt(new FinDecimal(10).pow(-digits))).toBe(true);

describe("fator diário e acumulado", () => {
  // 10/03/2025 (seg) a 24/03/2025 (seg): 10 dias úteis.
  const rates = fixedRates("2025-03-01", "2025-04-01");

  it("R$ 1.000 a 100% do CDI com 0,05% ao dia por 10 dias úteis", () => {
    const r = computeFixedIncome({ terms: terms("100"), movements: [dep("a", "2025-03-10", "1000")], rates, asOf: "2025-03-24" });
    close(r.current.gross, "1005.011265013132878282187675800782226562");
    expect(r.current.principal.toFixed()).toBe("1000");
  });

  it("R$ 1.000 a 115% do CDI: fator diário 1 + 0,05% × 1,15", () => {
    const r = computeFixedIncome({ terms: terms("115"), movements: [dep("a", "2025-03-10", "1000")], rates, asOf: "2025-03-24" });
    close(r.current.gross, "1005.764900961096554061326506132545730886");
  });

  it("rende da data do aporte (inclusive) até a data de cálculo (exclusive)", () => {
    const same = computeFixedIncome({ terms: terms("100"), movements: [dep("a", "2025-03-10", "1000")], rates, asOf: "2025-03-10" });
    expect(same.current.gross.toFixed()).toBe("1000");
    const oneDay = computeFixedIncome({ terms: terms("100"), movements: [dep("a", "2025-03-10", "1000")], rates, asOf: "2025-03-11" });
    expect(oneDay.current.gross.toFixed()).toBe("1000.5");
    // Sexta → segunda: só a sexta rende.
    const weekend = computeFixedIncome({ terms: terms("100"), movements: [dep("a", "2025-03-14", "1000")], rates, asOf: "2025-03-17" });
    expect(weekend.current.gross.toFixed()).toBe("1000.5");
  });

  it("feriado não rende (Carnaval 03 e 04/03/2025)", () => {
    const r = computeFixedIncome({
      terms: terms("100"),
      movements: [dep("a", "2025-02-28", "1000")],
      rates: fixedRates("2025-02-01", "2025-03-31"),
      asOf: "2025-03-06",
    });
    // 28/02, 05/03 → 2 dias úteis.
    close(r.current.gross, new FinDecimal(1000).times(new FinDecimal("1.0005").pow(2)));
  });

  it("spread anual: multiplica por (1 + s)^(1/252) a cada dia útil", () => {
    const r = computeFixedIncome({
      terms: terms("100", false, "0.1"),
      movements: [dep("a", "2025-03-10", "1000")],
      rates,
      asOf: "2025-03-24",
    });
    const expected = new FinDecimal(1000).times(
      new FinDecimal("1.0005").times(new FinDecimal("1.001").pow(new FinDecimal(1).dividedBy(252))).pow(10),
    );
    close(r.current.gross, expected, 15);
  });
});

describe("tributos na posição", () => {
  const rates = fixedRates("2024-01-01", "2026-12-31", "0.04");

  it("IOF e IR por prazo (CDB): 14 dias → IOF 53% e IR 22,5% sobre o restante", () => {
    const r = computeFixedIncome({ terms: terms("100"), movements: [dep("a", "2025-03-10", "1000")], rates, asOf: "2025-03-24" });
    const y = r.current.gross.minus(1000);
    close(r.current.iof, y.times("0.53"));
    close(r.current.incomeTax, y.minus(y.times("0.53")).times("0.225"));
    close(r.current.net, r.current.gross.minus(r.current.iof).minus(r.current.incomeTax));
  });

  it("LCI/LCA isenta: sem IR (após 30 dias também sem IOF)", () => {
    const r = computeFixedIncome({ terms: terms("95", true), movements: [dep("a", "2024-01-02", "1000")], rates, asOf: "2025-01-02" });
    expect(r.current.incomeTax.isZero()).toBe(true);
    expect(r.current.iof.isZero()).toBe(true);
    close(r.current.net, r.current.gross);
  });

  it("alíquota de IR por aporte (cada aporte tem seu prazo)", () => {
    const r = computeFixedIncome({
      terms: terms("100"),
      movements: [dep("a", "2024-01-02", "1000"), dep("b", "2025-06-02", "1000")],
      rates,
      asOf: "2025-07-15",
    });
    const g = (d: string) => new FinDecimal(1000).times(new FinDecimal("1.0004").pow(businessDaysBetween(d, "2025-07-15").length));
    const ga = g("2024-01-02");
    const gb = g("2025-06-02");
    const expectedIr = ga.minus(1000).times(incomeTaxRate(calendarDaysBetween("2024-01-02", "2025-07-15")))
      .plus(gb.minus(1000).times(incomeTaxRate(43)));
    close(r.current.incomeTax, expectedIr);
    expect(incomeTaxRate(calendarDaysBetween("2024-01-02", "2025-07-15")).toFixed()).toBe("0.175");
  });
});

describe("resgates pelo valor LÍQUIDO recebido (FIFO)", () => {
  const rates = fixedRates("2024-01-01", "2026-12-31", "0.04");

  it("resgate parcial consome o aporte mais antigo primeiro e calcula o bruto equivalente", () => {
    const r = computeFixedIncome({
      terms: terms("100"),
      movements: [dep("a", "2024-01-02", "1000"), dep("b", "2025-01-02", "500"), wd("w", "2025-03-10", "600")],
      rates,
      asOf: "2025-03-10",
    });
    const w = r.withdrawals[0];
    // Bruto − IOF − IR = líquido informado.
    close(w.gross.minus(w.iof).minus(w.incomeTax), "600");
    expect(w.excess.isZero()).toBe(true);
    // Só o aporte "a" (433 dias → IR 17,5%, sem IOF) foi consumido.
    const ga = new FinDecimal(1000).times(new FinDecimal("1.0004").pow(businessDaysBetween("2024-01-02", "2025-03-10").length));
    const netA = ga.minus(ga.minus(1000).times("0.175"));
    const f = new FinDecimal(600).dividedBy(netA);
    close(w.principal, f.times(1000));
    close(w.gross, f.times(ga));
    expect(w.iof.isZero()).toBe(true);
    // Sobra: (1 − f) do aporte "a" + aporte "b" inteiro.
    close(r.current.principal, new FinDecimal(1000).times(new FinDecimal(1).minus(f)).plus(500));
    expect(w.gross.gt(600)).toBe(true);
  });

  it("resgate maior que o aporte mais antigo passa para o próximo", () => {
    const r = computeFixedIncome({
      terms: terms("100"),
      movements: [dep("a", "2025-01-02", "100"), dep("b", "2025-02-03", "1000"), wd("w", "2025-03-10", "300")],
      rates,
      asOf: "2025-03-10",
    });
    const w = r.withdrawals[0];
    close(w.gross.minus(w.iof).minus(w.incomeTax), "300");
    expect(w.principal.gt(100)).toBe(true); // consumiu todo o "a" e parte do "b"
    close(r.current.principal, new FinDecimal(1100).minus(w.principal));
  });

  it("resgate de tudo zera a posição; acima do saldo informa o excesso", () => {
    const base = { terms: terms("100"), rates, asOf: "2025-03-10" };
    const before = computeFixedIncome({ ...base, movements: [dep("a", "2025-01-02", "1000")] });
    const all = computeFixedIncome({ ...base, movements: [dep("a", "2025-01-02", "1000"), wd("w", "2025-03-10", before.current.net.toFixed())] });
    close(all.current.gross, "0");
    expect(all.withdrawals[0].excess.lt("1e-20")).toBe(true);
    const over = computeFixedIncome({ ...base, movements: [dep("a", "2025-01-02", "1000"), wd("w", "2025-03-10", before.current.net.plus(50).toFixed())] });
    close(over.withdrawals[0].excess, "50", 15);
    expect(over.current.gross.isZero()).toBe(true);
  });

  it("resgate com IOF (menos de 30 dias): bruto equivalente cobre IOF e IR", () => {
    const r = computeFixedIncome({
      terms: terms("100"),
      movements: [dep("a", "2025-03-10", "1000"), wd("w", "2025-03-20", "500")],
      rates,
      asOf: "2025-03-20",
    });
    const w = r.withdrawals[0];
    expect(w.iof.gt(0)).toBe(true);
    close(w.gross.minus(w.iof).minus(w.incomeTax), "500");
  });

  it("aporte e resgate no mesmo dia: aporte entra antes, sem rendimento", () => {
    const r = computeFixedIncome({
      terms: terms("100"),
      movements: [wd("w", "2025-03-10", "200", 0), dep("a", "2025-03-10", "1000", 1)],
      rates,
      asOf: "2025-03-10",
    });
    expect(r.withdrawals[0].gross.toFixed()).toBe("200");
    expect(r.current.principal.toFixed()).toBe("800");
  });

  it("resgate sem saldo: excesso total", () => {
    const r = computeFixedIncome({ terms: terms("100"), movements: [wd("w", "2025-03-10", "10")], rates, asOf: "2025-03-10" });
    expect(r.withdrawals[0].excess.toFixed()).toBe("10");
  });
});

describe("projeção e evolução mensal", () => {
  it("dias úteis sem taxa publicada usam a última taxa conhecida (projeção)", () => {
    const rates = fixedRates("2025-03-01", "2025-03-17"); // até sexta 14/03
    const r = computeFixedIncome({ terms: terms("100"), movements: [dep("a", "2025-03-10", "1000")], rates, asOf: "2025-03-24" });
    expect(r.ratesKnownUntil).toBe("2025-03-14");
    expect(r.projectedBusinessDays).toBe(5);
    expect(r.missingBusinessDays).toBe(0);
    close(r.current.gross, "1005.011265013132878282187675800782226562");
  });

  it("sem nenhuma taxa: não rende e sinaliza", () => {
    const r = computeFixedIncome({ terms: terms("100"), movements: [dep("a", "2025-03-10", "1000")], rates: new Map(), asOf: "2025-03-24" });
    expect(r.current.gross.toFixed()).toBe("1000");
    expect(r.missingBusinessDays).toBe(10);
    expect(r.ratesKnownUntil).toBeNull();
  });

  it("evolução mês a mês: soma dos rendimentos = acumulado", () => {
    const rates = fixedRates("2025-01-01", "2025-12-31", "0.045");
    const r = computeFixedIncome({
      terms: terms("115"),
      movements: [dep("a", "2025-01-15", "1000"), dep("b", "2025-02-10", "200"), wd("w", "2025-03-05", "150")],
      rates,
      asOf: "2025-04-10",
    });
    expect(r.months.map((m) => m.month)).toEqual(["2025-01", "2025-02", "2025-03", "2025-04"]);
    const sum = r.months.reduce((acc, m) => acc.plus(m.earnings), new FinDecimal(0));
    close(sum, r.accumulatedEarnings);
    close(r.accumulatedEarnings, r.current.gross.plus(r.totalWithdrawnGross).minus(1200));
    expect(r.months[1].deposits.toFixed()).toBe("200");
    expect(r.months[2].withdrawalsNet.toFixed()).toBe("150");
    close(r.monthEarnings, r.months[3].earnings);
    // Fim de janeiro = valor em 01/02 (rendeu de 15/01 a 31/01).
    const jan = new FinDecimal(1000).times(new FinDecimal("1").plus(new FinDecimal("0.045").dividedBy(100).times("1.15")).pow(businessDaysBetween("2025-01-15", "2025-02-01").length));
    close(r.months[0].end.gross, jan);
  });

  it("valida entradas", () => {
    expect(() => computeFixedIncome({ terms: terms("0"), movements: [dep("a", "2025-01-02", "1")], rates: new Map(), asOf: "2025-01-03" })).toThrow(FixedIncomeError);
    expect(() => computeFixedIncome({ terms: terms("100"), movements: [dep("a", "2025-01-02", "0")], rates: new Map(), asOf: "2025-01-03" })).toThrow(FixedIncomeError);
    // Movimentos futuros (após asOf) são ignorados.
    const r = computeFixedIncome({ terms: terms("100"), movements: [dep("a", "2030-01-02", "1")], rates: new Map(), asOf: "2025-01-03" });
    expect(r.current.gross.isZero()).toBe(true);
  });
});
