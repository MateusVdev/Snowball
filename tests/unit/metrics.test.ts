import { describe, expect, it } from "vitest";
import {
  computePortfolioTotals,
  computePositionMetrics,
} from "@/domain/portfolio/metrics";
import { formatBRL, formatPercent, roundMoney } from "@/domain/money";

const brl = (v: Parameters<typeof formatBRL>[0]) => formatBRL(v).replace(/\s/g, " ");

describe("métricas da carteira inicial informada", () => {
  // MXRF11: 31 cotas, PM 8,44, cotação manual 8,52
  //   investido = 261,64 ; valor = 31 × 8,52 = 264,12
  //   não realizado = 2,48 ; rentabilidade = 2,48 / 261,64 = 0,94786… → 0,95%
  const mxrf = computePositionMetrics({
    quantity: "31",
    totalCost: "261.64",
    realizedResult: "0",
    currentPrice: "8.52",
  });
  // HGLG11: 1 cota, PM 145,00, cotação manual 141,80
  //   investido = 145,00 ; valor = 141,80 ; não realizado = −3,20
  //   rentabilidade = −3,20 / 145 = −2,2069% → −2,21%
  const hglg = computePositionMetrics({
    quantity: "1",
    totalCost: "145",
    realizedResult: "0",
    currentPrice: "141.80",
  });

  it("MXRF11", () => {
    expect(mxrf.averagePrice?.toString()).toBe("8.44");
    expect(roundMoney(mxrf.investedCapital!).toFixed(2)).toBe("261.64");
    expect(mxrf.currentValue?.toFixed(2)).toBe("264.12");
    expect(mxrf.unrealizedResult?.toFixed(2)).toBe("2.48");
    expect(formatPercent(mxrf.unrealizedReturn!)).toBe("0,95%");
  });

  it("HGLG11", () => {
    expect(hglg.averagePrice?.toString()).toBe("145");
    expect(hglg.currentValue?.toFixed(2)).toBe("141.80");
    expect(hglg.unrealizedResult?.toFixed(2)).toBe("-3.20");
    expect(formatPercent(hglg.unrealizedReturn!)).toBe("-2,21%");
  });

  it("totais: investido 406,64; valor 405,92; resultado −0,72 (−0,18%)", () => {
    // −0,72 / 406,64 = −0,17706… → −0,18%
    const totals = computePortfolioTotals([mxrf, hglg]);
    expect(brl(totals.investedCapital)).toBe("R$ 406,64");
    expect(brl(totals.currentValue)).toBe("R$ 405,92");
    expect(brl(totals.unrealizedResult)).toBe("-R$ 0,72");
    expect(formatPercent(totals.unrealizedReturn!)).toBe("-0,18%");
    expect(totals.positionsWithoutQuote).toBe(0);
  });
});

describe("casos especiais", () => {
  it("sem cotação: campos de mercado indisponíveis (null), nunca estimados", () => {
    const m = computePositionMetrics({
      quantity: "10",
      totalCost: "100",
      realizedResult: "5",
      currentPrice: null,
    });
    expect(m.currentValue).toBeNull();
    expect(m.unrealizedResult).toBeNull();
    expect(m.unrealizedReturn).toBeNull();
    expect(m.totalResult).toBeNull();
    expect(m.averagePrice?.toString()).toBe("10");
    const totals = computePortfolioTotals([m]);
    expect(totals.positionsWithoutQuote).toBe(1);
    expect(totals.unrealizedReturn).toBeNull();
  });

  it("posição zerada mantém o resultado realizado", () => {
    const m = computePositionMetrics({
      quantity: "0",
      totalCost: "0",
      realizedResult: "-4.64",
      currentPrice: "8.20",
    });
    expect(m.averagePrice).toBeNull();
    expect(m.currentValue?.toString()).toBe("0");
    expect(m.unrealizedReturn).toBeNull();
    expect(m.totalResult?.toString()).toBe("-4.64");
  });

  it("resultado total = realizado + não realizado", () => {
    // 30 cotas, C = 253,134, cotação 9 → valor 270; não realizado 16,866; realizado 2,844 → total 19,71
    const m = computePositionMetrics({
      quantity: "30",
      totalCost: "253.134",
      realizedResult: "2.844",
      currentPrice: "9",
    });
    expect(m.unrealizedResult?.toString()).toBe("16.866");
    expect(m.totalResult?.toFixed(2)).toBe("19.71");
  });
});
