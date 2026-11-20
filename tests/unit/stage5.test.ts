import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { allocation, ledgerStateAt, monthlyFlows, portfolioHistory, priceAt } from "@/domain/portfolio/history";
import { estimateMonthsToGoal, goalProgress } from "@/domain/goals";
import { example96Config, simulate, strategyVariants, defaultConfig, defaultFund } from "@/domain/simulation";
import type { LedgerOperationInput } from "@/domain/portfolio/ledger";
import { num, text, date, toCsv, toXlsx } from "@/server/export/tabular";
import { buildCsp } from "@/proxy";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
let seq = 0;
const op = (type: LedgerOperationInput["type"], qty: string, price: string, dateIso: string | null): LedgerOperationInput => ({
  id: `o${++seq}`, type, tradeDate: dateIso ? d(dateIso) : null, sequence: seq, quantity: qty, unitPrice: price, fees: "0",
});

describe("evolução da carteira (reconstrução a partir dos registros)", () => {
  const fund = {
    fundId: "A", ticker: "AAAA11",
    operations: [op("BUY", "10", "10", "2026-01-10"), op("BUY", "10", "12", "2026-03-05"), op("SELL", "5", "13", "2026-03-20")],
    initialBalanceKnownSince: null,
    prices: [
      { asOf: new Date("2026-01-30T21:00:00Z"), price: "10.50" },
      { asOf: new Date("2026-03-31T21:00:00Z"), price: "13.00" },
    ],
  };

  it("estado do ledger e preço em cada data", () => {
    expect(ledgerStateAt(fund.operations, d("2026-02-28"), null)?.quantity.toString()).toBe("10");
    expect(priceAt(fund.prices, d("2026-02-28"))?.toString()).toBe("10.5"); // última cotação até a data
    expect(priceAt(fund.prices, d("2026-01-15"))).toBeNull();
  });

  it("série mensal: investido e valor de mercado; sem preço → indisponível", () => {
    const h = portfolioHistory([fund], "2026-04-15");
    expect(h.map((p) => p.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    // Jan: 10 cotas × 10,50 = 105; investido 100
    expect(h[0]).toMatchObject({ missing: [] });
    expect(h[0].investedCapital?.toString()).toBe("100");
    expect(h[0].marketValue?.toString()).toBe("105");
    // Mar: compra 10 × 12 (C=220, Q=20) e venda 5 (custo 55) → Q=15, C=165; valor 15 × 13 = 195
    expect(h[2].investedCapital?.toString()).toBe("165");
    expect(h[2].marketValue?.toString()).toBe("195");
  });

  it("saldo inicial só é conhecido a partir do registro; antes, o mês fica indisponível", () => {
    const withInitial = { ...fund, operations: [op("INITIAL_BALANCE", "31", "8.44", null)], initialBalanceKnownSince: d("2026-03-10") };
    const h = portfolioHistory([withInitial], "2026-03-31");
    expect(h).toHaveLength(1); // começa no mês do registro
    expect(h[0].marketValue?.toFixed(2)).toBe("403.00"); // 31 × 13
    const before = ledgerStateAt(withInitial.operations, d("2026-02-28"), withInitial.initialBalanceKnownSince);
    expect(before).toBeNull();
  });

  it("aportes por mês e distribuição", () => {
    const flows = monthlyFlows([
      { type: "INITIAL_BALANCE", tradeDate: null, netAmount: "261.64" },
      { type: "BUY", tradeDate: d("2026-03-05"), netAmount: "120" },
      { type: "SELL", tradeDate: d("2026-03-20"), netAmount: "65" },
    ]);
    expect(flows.map((f) => [f.month, f.net.toString()])).toEqual([["2026-03", "55"]]);
    const a = allocation([{ key: "x", label: "X", value: "300" }, { key: "y", label: "Y", value: "100" }, { key: "x", label: "X", value: "0" }]);
    expect(a.map((s) => [s.label, s.share.toString()])).toEqual([["X", "0.75"], ["Y", "0.25"]]);
  });
});

describe("metas", () => {
  it("progresso e restante", () => {
    const p = goalProgress("25", "100");
    expect(p.fraction.toString()).toBe("0.25");
    expect(p.remaining.toString()).toBe("75");
    expect(goalProgress("150", "100")).toMatchObject({ reached: true });
    expect(goalProgress("150", "100").fraction.toString()).toBe("1");
  });

  it("estimativa de prazo pela simulação (exemplo 96 cotas)", () => {
    const rows = simulate(example96Config(60)).months;
    // 100 cotas são alcançadas no fim do mês 5 (96→97→98→99→100)
    expect(estimateMonthsToGoal("TOTAL_SHARES", "100", rows)).toBe(5);
    // Renda de R$ 10,00 no mês 6 (100 × 0,10)
    expect(estimateMonthsToGoal("MONTHLY_INCOME", "10", rows)).toBe(6);
    expect(estimateMonthsToGoal("PATRIMONY", "100000", rows)).toBeNull();
    expect(estimateMonthsToGoal("CUSTOM", "1", rows)).toBeNull();
  });
});

describe("comparação de estratégias", () => {
  it("mesmas premissas; 0% não compra cotas; 100% = configurada quando já é 100%", () => {
    const cfg = example96Config(24);
    const v = strategyVariants(cfg).map((x) => ({ key: x.key, s: simulate(x.config).summary }));
    expect(v.map((x) => x.key)).toEqual(["CONFIGURED", "REINVEST_ALL", "REINVEST_NONE"]);
    expect(v[0].s).toEqual(v[1].s);
    expect(v[2].s.finalShares).toBe("96");
    expect(v[2].s.totalNotReinvested).toBe("230.40"); // 24 × 9,60
    expect(Number(v[0].s.sharesBoughtWithDividendsOnly)).toBeGreaterThan(0);
  });

  it("concentrar no maior dividendo/preço com vários fundos", () => {
    const cfg = defaultConfig({
      months: 6,
      funds: [
        defaultFund({ key: "A", ticker: "A", initialQuantity: "10", price: "10", monthlyDividend: "0.08" }),
        defaultFund({ key: "B", ticker: "B", initialQuantity: "10", price: "100", monthlyDividend: "1.10" }),
      ],
    });
    const best = strategyVariants(cfg).find((x) => x.key === "HIGHEST_YIELD")!;
    expect(best.label).toBe("Concentrar em B");
    expect(best.config.allocation).toEqual({ mode: "WEIGHTS", weights: { A: "0", B: "100" } });
  });
});

describe("exportação CSV e Excel", () => {
  const ds = {
    name: "Carteira",
    columns: ["Ticker", "Cotas", "Preço", "Data", "Obs"],
    rows: [
      [text("MXRF11"), num("31"), num("8.44"), date(d("2026-11-20")), text("=HYPERLINK(\"x\")")],
      [text('Nome; com "aspas"'), num(null), num("-0.72"), date(null), text(null)],
    ],
  };

  it("CSV: BOM, ';', decimal com vírgula e proteção contra fórmulas", () => {
    const csv = toCsv(ds);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Ticker;Cotas;Preço;Data;Obs");
    expect(lines[1]).toBe(`MXRF11;31;8,44;2026-11-20;"'=HYPERLINK(""x"")"`);
    expect(lines[2]).toBe(`"Nome; com ""aspas""";;-0,72;;`);
  });

  it("XLSX: pacote OOXML válido com números como números", () => {
    const files = unzipSync(toXlsx([ds, { ...ds, name: "Carteira" }]));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('<c r="C2"><v>8.44</v></c>');
    expect(sheet).toContain("MXRF11");
    expect(sheet).toContain("&quot;"); // texto escapado
    const wb = strFromU8(files["xl/workbook.xml"]);
    expect(wb).toContain('name="Carteira"');
    expect(wb).toContain('name="Carteira 2"'); // nomes de planilha únicos
  });
});

describe("Content-Security-Policy", () => {
  it("scripts só com nonce; sem unsafe-eval em produção; sem frames", () => {
    const csp = buildCsp("abc", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(buildCsp("abc", true)).toContain("'unsafe-eval'");
  });
});
