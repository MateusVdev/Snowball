import { describe, expect, it } from "vitest";
import { formatBRL, roundMoney, roundTo, toDecimal } from "@/domain/money";

describe("primitivas monetárias", () => {
  it("evita erros de ponto flutuante", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(toDecimal("0.1").plus("0.2").equals("0.3")).toBe(true);
  });

  it("arredonda half-up na escala monetária", () => {
    expect(roundMoney("2.345").toFixed(2)).toBe("2.35");
    expect(roundMoney("2.344").toFixed(2)).toBe("2.34");
    expect(roundMoney("-2.345").toFixed(2)).toBe("-2.35");
    expect(roundTo("1.123456789", 8).toString()).toBe("1.12345679");
  });

  it("rejeita valores não finitos", () => {
    expect(() => toDecimal(Number.NaN)).toThrow(RangeError);
    expect(() => toDecimal(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toDecimal("abc")).toThrow();
  });

  it("formata em reais (pt-BR)", () => {
    const normalize = (s: string) => s.replace(/\s/g, " ");
    expect(normalize(formatBRL("1234.5"))).toBe("R$ 1.234,50");
    expect(normalize(formatBRL("0.005"))).toBe("R$ 0,01");
  });
});
