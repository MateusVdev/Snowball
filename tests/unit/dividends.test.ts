import { describe, expect, it } from "vitest";
import {
  dividendAmount,
  dividendEventStatus,
  dividendYield12m,
  eligibleQuantityAt,
  minusMonthsIso,
  parseCompetence,
  summarizeIncome,
} from "@/domain/dividends";
import type { LedgerOperationInput } from "@/domain/portfolio/ledger";
import { formatPercent } from "@/domain/money";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
let seq = 0;
const op = (type: LedgerOperationInput["type"], qty: string, date: string | null, price = "10"): LedgerOperationInput => ({
  id: `o${++seq}`,
  type,
  tradeDate: date ? d(date) : null,
  sequence: seq,
  quantity: qty,
  unitPrice: price,
  fees: "0",
});

describe("quantidade elegível na data-com", () => {
  const ops = [
    op("BUY", "10", "2026-01-05"),
    op("BUY", "5", "2026-01-30"), // compra NA data-com: tem direito
    op("SELL", "3", "2026-02-10"),
  ];

  it("usa a posição ao final da data-com, não a quantidade atual", () => {
    // Data-com 30/01: 10 + 5 = 15 (a venda de 10/02 não afeta)
    const e = eligibleQuantityAt(ops, d("2026-01-30"), null);
    expect(e).toMatchObject({ status: "KNOWN" });
    if (e.status === "KNOWN") expect(e.quantity.toString()).toBe("15");
    // Data-com 27/02: 15 − 3 = 12
    const later = eligibleQuantityAt(ops, d("2026-02-27"), null);
    if (later.status === "KNOWN") expect(later.quantity.toString()).toBe("12");
  });

  it("antes da primeira compra: zero cotas", () => {
    const e = eligibleQuantityAt(ops, d("2026-01-02"), null);
    if (e.status === "KNOWN") expect(e.quantity.toString()).toBe("0");
  });

  it("venda na data-com: o vendedor perde o direito", () => {
    const e = eligibleQuantityAt([op("BUY", "10", "2026-03-01"), op("SELL", "10", "2026-03-31")], d("2026-03-31"), null);
    if (e.status === "KNOWN") expect(e.quantity.toString()).toBe("0");
  });

  it("saldo inicial só vale a partir do dia em que foi registrado", () => {
    const withInitial = [op("INITIAL_BALANCE", "31", null, "8.44"), op("BUY", "4", "2026-11-25", "8.5")];
    // Registrado em 20/11/2026: data-com 30/10 → desconhecida (não supomos a posição)
    const before = eligibleQuantityAt(withInitial, d("2026-10-30"), d("2026-11-20"));
    expect(before.status).toBe("UNKNOWN");
    // Data-com 30/11 → 31 + 4
    const after = eligibleQuantityAt(withInitial, d("2026-11-30"), d("2026-11-20"));
    expect(after).toMatchObject({ status: "KNOWN" });
    if (after.status === "KNOWN") expect(after.quantity.toString()).toBe("35");
    // No próprio dia do registro: conhecida
    const same = eligibleQuantityAt(withInitial, d("2026-11-20"), d("2026-11-20"));
    if (same.status === "KNOWN") expect(same.quantity.toString()).toBe("31");
  });
});

describe("valor e status do provento", () => {
  it("valor = quantidade × valor por cota, arredondado a centavos", () => {
    // 31 × 0,095 = 2,945 → 2,95 (half-up); 1 × 1,17 = 1,17
    expect(dividendAmount("31", "0.095").toFixed(2)).toBe("2.95");
    expect(dividendAmount("1", "1.17").toFixed(2)).toBe("1.17");
    // Amortização com 9 casas: 100 × 0,308363541 = 30,8363541 → 30,84
    expect(dividendAmount("100", "0.308363541").toFixed(2)).toBe("30.84");
  });

  it("anunciado × pago × previsto", () => {
    const today = "2026-11-20";
    expect(dividendEventStatus({ kind: "OFFICIAL", paymentDate: d("2026-12-15") }, today)).toBe("ANNOUNCED");
    expect(dividendEventStatus({ kind: "OFFICIAL", paymentDate: null }, today)).toBe("ANNOUNCED");
    expect(dividendEventStatus({ kind: "OFFICIAL", paymentDate: d("2026-11-20") }, today)).toBe("PAID");
    expect(dividendEventStatus({ kind: "OFFICIAL", paymentDate: d("2026-11-16") }, today)).toBe("PAID");
    expect(dividendEventStatus({ kind: "FORECAST", paymentDate: d("2026-12-15") }, today)).toBe("FORECAST");
  });
});

describe("competência (sem supor o ano)", () => {
  it.each([
    ["Outubro-2026", "2026-10"],
    ["Março-2026", "2026-03"],
    ["Novembro-2026", "2026-11"],
    ["10/2026", "2026-10"],
    ["2026-10", "2026-10"],
    ["outubro de 2026", "2026-10"],
    ["OUTUBRO", null],
    ["Julho", null],
    ["", null],
    [null, null],
  ])("%s → %s", (label, expected) => {
    expect(parseCompetence(label)).toBe(expected);
  });
});

describe("histórico de renda", () => {
  const today = "2026-11-20";
  const r = (ticker: string, date: string, amount: string, type: "INCOME" | "AMORTIZATION" = "INCOME") => ({
    fundId: ticker, ticker, type, paymentDate: d(date), totalAmount: amount,
  });
  const receipts = [
    r("MXRF11", "2025-11-14", "3.10"), // fora da janela de 12 meses (≤ 20/11/2025)
    r("MXRF11", "2025-12-12", "3.10"),
    r("HGLG11", "2026-10-15", "1.17"),
    r("MXRF11", "2026-10-15", "3.10"),
    r("MXRF11", "2026-11-16", "2.95"),
    r("HGLG11", "2026-11-16", "1.17"),
    r("KISU11", "2026-11-16", "30.84", "AMORTIZATION"),
    r("MXRF11", "2026-12-15", "3.00"), // futuro: ainda não é renda
  ];
  const s = summarizeIncome(receipts, today);

  it("totais, 12 meses e médias", () => {
    // Total: 3,10 + 3,10 + 1,17 + 3,10 + 2,95 + 1,17 = 14,59
    expect(s.totalReceived.toFixed(2)).toBe("14.59");
    // 12 meses (> 20/11/2025): 14,59 − 3,10 = 11,49
    expect(s.last12Months.toFixed(2)).toBe("11.49");
    // Renda passiva mensal média 12m: 11,49 / 12 = 0,9575 → 0,96
    expect(s.monthlyAverage12m.toFixed(2)).toBe("0.96");
    // Meses de 2025-11 a 2026-11 = 13 → 14,59 / 13 = 1,1223…
    expect(s.monthly).toHaveLength(13);
    expect(s.monthlyAverageSinceFirst?.toFixed(2)).toBe("1.12");
    expect(s.currentMonth.toFixed(2)).toBe("4.12");
    expect(s.previousMonth.toFixed(2)).toBe("4.27");
    expect(s.amortizationTotal.toFixed(2)).toBe("30.84");
  });

  it("mensal (com meses zerados), anual e por fundo", () => {
    expect(s.monthly.find((m) => m.month === "2026-03")?.total.toFixed(2)).toBe("0.00");
    expect(s.yearly.map((y) => [y.year, y.total.toFixed(2)])).toEqual([
      [2025, "6.20"],
      [2026, "8.39"],
    ]);
    expect(s.byFund.map((f) => [f.ticker, f.total.toFixed(2), f.last12Months.toFixed(2)])).toEqual([
      ["MXRF11", "12.25", "9.15"],
      ["HGLG11", "2.34", "2.34"],
    ]);
  });

  it("janela de 12 meses respeita fim de mês", () => {
    expect(minusMonthsIso("2026-03-31", 1)).toBe("2026-02-28");
    expect(minusMonthsIso("2026-11-20", 12)).toBe("2025-11-20");
  });
});

describe("dividend yield", () => {
  const today = "2026-11-20";
  const ev = (pay: string, rate: string, extra: Partial<{ kind: "OFFICIAL" | "FORECAST"; type: "INCOME" | "AMORTIZATION" }> = {}) => ({
    kind: extra.kind ?? ("OFFICIAL" as const), type: extra.type ?? ("INCOME" as const), paymentDate: d(pay), ratePerShare: rate,
  });
  // 12 pagamentos mensais de 0,10 (dez/2025 a nov/2026, um de 0,095)
  const monthly = [
    ev("2025-11-14", "0.10"), // fora da janela, mas comprova cobertura
    ...["2025-12-12", "2026-01-15", "2026-02-13", "2026-03-13", "2026-04-15", "2026-05-15", "2026-06-15", "2026-07-14", "2026-08-14", "2026-09-15", "2026-10-15"].map((p) => ev(p, "0.10")),
    ev("2026-11-16", "0.095"),
  ];

  it("DY 12m e yield on cost com histórico suficiente", () => {
    // Σ = 11 × 0,10 + 0,095 = 1,195 ; DY = 1,195 / 8,52 = 14,0258…% ; YoC = 1,195 / 8,44 = 14,1588…%
    const r = dividendYield12m(
      [...monthly, ev("2026-12-15", "0.10", { kind: "FORECAST" }), ev("2026-06-01", "1", { type: "AMORTIZATION" })],
      "8.52", "8.44", today,
    );
    expect(r.sumPerShare12m.toString()).toBe("1.195");
    expect(r.eventsCount).toBe(12);
    expect(formatPercent(r.dividendYield12m!)).toBe("14,03%");
    expect(formatPercent(r.yieldOnCost12m!)).toBe("14,16%");
    expect(r.lastRatePerShare?.toString()).toBe("0.095");
  });

  it("dados insuficientes: histórico menor que 12 meses ou sem cotação", () => {
    const short = dividendYield12m(monthly.slice(-3), "8.52", "8.44", today);
    expect(short.dividendYield12m).toBeNull();
    expect(short.insufficientReason).toMatch(/menos de 12 meses/);
    const none = dividendYield12m([], "8.52", null, today);
    expect(none.dividendYield12m).toBeNull();
    const noPrice = dividendYield12m(monthly, null, null, today);
    expect(noPrice.dividendYield12m).toBeNull();
    expect(noPrice.insufficientReason).toBe("Sem cotação.");
  });
});
