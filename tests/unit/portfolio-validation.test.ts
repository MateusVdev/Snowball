import { describe, expect, it } from "vitest";
import { parseDecimalInput, formatQuantity, formatUnitPrice } from "@/domain/money";
import { parseIsoDate, todayIsoDate } from "@/domain/dates";
import {
  quantitySchema,
  tickerSchema,
  tradeSchema,
  unitPriceSchema,
  feesSchema,
} from "@/validation/portfolio";

describe("entrada numérica em pt-BR", () => {
  it.each([
    ["8,44", "8.44"],
    ["8.44", "8.44"],
    ["1.234,56", "1234.56"],
    ["R$ 145,00", "145"],
    ["  31 ", "31"],
    ["0,30", "0.3"],
  ])("%s → %s", (raw, expected) => {
    expect(parseDecimalInput(raw)).toBe(expected);
  });

  it.each(["", "abc", "1,2,3", "1.23.4", "8,44a", "1e5"])("rejeita %s", (raw) => {
    expect(parseDecimalInput(raw)).toBeNull();
  });
});

describe("schemas da carteira", () => {
  it("ticker normalizado e validado", () => {
    expect(tickerSchema.parse(" mxrf11 ")).toBe("MXRF11");
    expect(tickerSchema.safeParse("MXRF").success).toBe(false);
    expect(tickerSchema.safeParse("MXRF11X").success).toBe(false);
  });

  it("quantidade inteira e positiva", () => {
    expect(quantitySchema.parse("31")).toBe("31");
    expect(quantitySchema.safeParse("1,5").success).toBe(false);
    expect(quantitySchema.safeParse("0").success).toBe(false);
    expect(quantitySchema.safeParse("-1").success).toBe(false);
  });

  it("preço positivo com até 8 casas; taxas ≥ 0 com até 2 casas", () => {
    expect(unitPriceSchema.parse("141,80")).toBe("141.8");
    expect(unitPriceSchema.safeParse("0").success).toBe(false);
    expect(unitPriceSchema.safeParse("1,123456789").success).toBe(false);
    expect(feesSchema.parse("0")).toBe("0");
    expect(feesSchema.safeParse("0,001").success).toBe(false);
  });

  it("data da operação: válida e não futura", () => {
    const base = { type: "BUY", quantity: "1", unitPrice: "10", fees: "0" };
    expect(tradeSchema.safeParse({ ...base, tradeDate: "2026-02-30" }).success).toBe(false);
    expect(tradeSchema.safeParse({ ...base, tradeDate: "2999-01-01" }).success).toBe(false);
    const ok = tradeSchema.parse({ ...base, tradeDate: todayIsoDate() });
    expect(ok.tradeDate.toISOString().slice(0, 10)).toBe(todayIsoDate());
  });

  it("datas de calendário", () => {
    expect(parseIsoDate("2026-03-15")?.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(parseIsoDate("15/03/2026")).toBeNull();
  });
});

describe("formatação", () => {
  it("quantidade e preço unitário", () => {
    expect(formatQuantity("1234")).toBe("1.234");
    expect(formatUnitPrice("8.44").replace(/\s/g, " ")).toBe("R$ 8,44");
    expect(formatUnitPrice("8.46195122").replace(/\s/g, " ")).toBe("R$ 8,46195122");
  });
});
