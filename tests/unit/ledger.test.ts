import { describe, expect, it } from "vitest";
import {
  LedgerError,
  operationAmounts,
  replayLedger,
  type LedgerOperationInput,
} from "@/domain/portfolio/ledger";
import { roundMoney } from "@/domain/money";

/**
 * Valores conferidos manualmente. Notação: Q = quantidade, C = custo total.
 */
let seq = 0;
function op(
  type: LedgerOperationInput["type"],
  quantity: string,
  unitPrice: string,
  fees = "0",
  date: string | null = type === "INITIAL_BALANCE" ? null : "2026-01-10",
): LedgerOperationInput {
  seq += 1;
  return {
    id: `op${seq}`,
    type,
    tradeDate: date ? new Date(`${date}T00:00:00Z`) : null,
    sequence: seq,
    quantity,
    unitPrice,
    fees,
  };
}

const money = (d: { toFixed(n: number): string }) => d.toFixed(2);

describe("valores de uma operação", () => {
  it("compra: líquido = bruto + taxas", () => {
    // 10 × 8,50 = 85,00 ; + 0,30 = 85,30
    const r = operationAmounts("BUY", "10", "8.50", "0.30");
    expect(money(r.grossAmount)).toBe("85.00");
    expect(money(r.netAmount)).toBe("85.30");
  });

  it("venda: líquido = bruto − taxas", () => {
    // 20 × 8,60 = 172,00 ; − 0,40 = 171,60
    const r = operationAmounts("SELL", "20", "8.60", "0.40");
    expect(money(r.grossAmount)).toBe("172.00");
    expect(money(r.netAmount)).toBe("171.60");
  });

  it("bruto é arredondado a centavos (half-up)", () => {
    // 3 × 8,445 = 25,335 → 25,34
    expect(money(operationAmounts("BUY", "3", "8.445", "0").grossAmount)).toBe("25.34");
  });
});

describe("saldo inicial (carteira informada)", () => {
  it("MXRF11: 31 cotas a PM R$ 8,44 → custo R$ 261,64", () => {
    // 31 × 8,44 = 261,64
    const { final, steps } = replayLedger([op("INITIAL_BALANCE", "31", "8.44")]);
    expect(final.quantity.toString()).toBe("31");
    expect(final.totalCost.toFixed(2)).toBe("261.64");
    expect(steps[0].averagePriceAfter?.toString()).toBe("8.44");
  });

  it("preserva o preço médio exato mesmo com muitas casas", () => {
    // 3 × 8,4437 = 25,3311 (não arredonda o custo do saldo inicial)
    const { final, steps } = replayLedger([op("INITIAL_BALANCE", "3", "8.4437")]);
    expect(final.totalCost.toString()).toBe("25.3311");
    expect(steps[0].averagePriceAfter?.toString()).toBe("8.4437");
  });
});

describe("compras, vendas, taxas e preço médio — cenário completo", () => {
  // Saldo inicial 31 @ 8,44            → Q=31, C=261,64, PM=8,44
  // Compra 10 @ 8,50 + taxas 0,30      → C=261,64+85,30=346,94; Q=41; PM=346,94/41=8,46195121…
  // Compra  9 @ 8,30 + taxas 0,25      → C=346,94+74,95=421,89; Q=50; PM=8,4378
  // Venda  20 @ 8,60 − taxas 0,40      → líquido 171,60; custo vendido=421,89×20/50=168,756
  //                                      realizado=171,60−168,756=+2,844; Q=30; C=253,134; PM=8,4378 (inalterado)
  // Venda  30 @ 8,20 − taxas 0,35      → líquido 245,65; custo vendido=253,134
  //                                      realizado=245,65−253,134=−7,484; Q=0; C=0
  // Realizado total = 2,844 − 7,484 = −4,64
  const ops = [
    op("INITIAL_BALANCE", "31", "8.44"),
    op("BUY", "10", "8.50", "0.30", "2026-02-02"),
    op("BUY", "9", "8.30", "0.25", "2026-02-10"),
    op("SELL", "20", "8.60", "0.40", "2026-03-05"),
    op("SELL", "30", "8.20", "0.35", "2026-04-01"),
  ];
  const { steps, final } = replayLedger(ops);

  it("recalcula o preço médio nas compras, incluindo taxas", () => {
    expect(steps[1].quantityAfter.toString()).toBe("41");
    expect(steps[1].totalCostAfter.toFixed(2)).toBe("346.94");
    expect(steps[1].averagePriceAfter?.toString()).toBe("8.46195122");
    expect(steps[2].quantityAfter.toString()).toBe("50");
    expect(steps[2].totalCostAfter.toFixed(2)).toBe("421.89");
    expect(steps[2].averagePriceAfter?.toString()).toBe("8.4378");
  });

  it("venda usa o preço médio anterior e não altera o PM remanescente", () => {
    const sell = steps[3];
    expect(sell.costOfSold?.toString()).toBe("168.756");
    expect(sell.realizedResult?.toString()).toBe("2.844");
    expect(roundMoney(sell.realizedResult!).toFixed(2)).toBe("2.84");
    expect(sell.quantityAfter.toString()).toBe("30");
    expect(sell.totalCostAfter.toString()).toBe("253.134");
    expect(sell.averagePriceAfter?.toString()).toBe("8.4378");
  });

  it("prejuízo realizado e posição zerada", () => {
    const sell = steps[4];
    expect(sell.costOfSold?.toString()).toBe("253.134");
    expect(sell.realizedResult?.toString()).toBe("-7.484");
    expect(final.quantity.isZero()).toBe(true);
    expect(final.totalCost.isZero()).toBe(true);
    expect(sell.averagePriceAfter).toBeNull();
    expect(final.realizedResult.toString()).toBe("-4.64");
  });
});

describe("arredondamento", () => {
  it("vendas parciais com PM dízima não acumulam erro", () => {
    // Compra 3 @ 10,00 + 0,01 → C=30,01; PM=10,00333…
    // Venda 1 @ 10,00 → custo=10,00333…; realizado=−0,00333…
    // Venda 2 @ 10,00 → custo=20,00666…; realizado=−0,00666…
    // Total realizado = −0,01 exatamente (= taxa paga); C final = 0 exato
    const { steps, final } = replayLedger([
      op("BUY", "3", "10.00", "0.01", "2026-01-02"),
      op("SELL", "1", "10.00", "0", "2026-01-03"),
      op("SELL", "2", "10.00", "0", "2026-01-04"),
    ]);
    expect(final.realizedResult.toString()).toBe("-0.01");
    expect(final.totalCost.isZero()).toBe(true);
    expect(steps[1].averagePriceAfter?.toString()).toBe("10.00333333");
  });

  it("0,1 + 0,2 em cotas: soma exata de custos", () => {
    const { final } = replayLedger([
      op("BUY", "1", "0.1", "0", "2026-01-02"),
      op("BUY", "1", "0.2", "0", "2026-01-03"),
    ]);
    expect(final.totalCost.toString()).toBe("0.3");
  });
});

describe("validações do histórico", () => {
  it("rejeita venda acima do saldo", () => {
    expect(() =>
      replayLedger([
        op("INITIAL_BALANCE", "31", "8.44"),
        op("SELL", "32", "9", "0", "2026-01-05"),
      ]),
    ).toThrowError(expect.objectContaining({ code: "INSUFFICIENT_QUANTITY" }));
  });

  it("valida o saldo na data da operação (venda retroativa)", () => {
    // Venda em 01/02 antes da compra de 01/03 → saldo 0 na data da venda.
    expect(() =>
      replayLedger([
        op("BUY", "10", "10", "0", "2026-03-01"),
        op("SELL", "5", "10", "0", "2026-02-01"),
      ]),
    ).toThrow(LedgerError);
  });

  it("ordena por data independentemente da ordem de entrada", () => {
    const { final } = replayLedger([
      op("SELL", "5", "12", "0", "2026-03-10"),
      op("BUY", "10", "10", "0", "2026-03-01"),
    ]);
    // Custo vendido = 100 × 5/10 = 50; realizado = 60 − 50 = 10
    expect(final.quantity.toString()).toBe("5");
    expect(final.realizedResult.toString()).toBe("10");
  });

  it("mesma data: respeita a ordem de registro", () => {
    expect(() =>
      replayLedger([
        { ...op("SELL", "1", "10", "0", "2026-05-01"), sequence: 1 },
        { ...op("BUY", "1", "10", "0", "2026-05-01"), sequence: 2 },
      ]),
    ).toThrowError(expect.objectContaining({ code: "INSUFFICIENT_QUANTITY" }));
  });

  it("rejeita dois saldos iniciais", () => {
    expect(() =>
      replayLedger([
        op("INITIAL_BALANCE", "1", "10"),
        op("INITIAL_BALANCE", "1", "10"),
      ]),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_INITIAL_BALANCE" }));
  });

  it("rejeita quantidade/preço não positivos e taxa negativa", () => {
    expect(() => replayLedger([op("BUY", "0", "10")])).toThrow(LedgerError);
    expect(() => replayLedger([op("BUY", "1", "0")])).toThrow(LedgerError);
    expect(() => replayLedger([op("BUY", "1", "10", "-1")])).toThrow(LedgerError);
  });

  it("compra/venda sem data é inválida", () => {
    expect(() => replayLedger([op("BUY", "1", "10", "0", null)])).toThrowError(
      expect.objectContaining({ code: "MISSING_TRADE_DATE" }),
    );
  });
});
