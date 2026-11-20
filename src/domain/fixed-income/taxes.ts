import { FinDecimal } from "@/domain/money";

/**
 * Tributos sobre o RENDIMENTO de renda fixa (pessoa física), por aporte.
 * Estimativa — a cobrança real é feita pela instituição.
 */

/**
 * IR regressivo pelo prazo do aporte, em dias corridos:
 * até 180 → 22,5% · 181 a 360 → 20% · 361 a 720 → 17,5% · acima de 720 → 15%.
 */
export function incomeTaxRate(days: number): FinDecimal {
  if (days <= 180) return new FinDecimal("0.225");
  if (days <= 360) return new FinDecimal("0.20");
  if (days <= 720) return new FinDecimal("0.175");
  return new FinDecimal("0.15");
}

/**
 * IOF regressivo (Decreto 6.306/2007, Anexo): percentual do rendimento por
 * dias corridos desde a aplicação. Dia 30 em diante: 0%.
 */
export const IOF_TABLE: readonly number[] = [
  // dia: 0 (mesmo dia — não há rendimento) e 1 a 29
  100, 96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36, 33, 30, 26, 23, 20, 16, 13, 10, 6, 3,
];

export function iofRate(days: number): FinDecimal {
  if (days >= 30) return new FinDecimal(0);
  return new FinDecimal(IOF_TABLE[Math.max(0, days)]).dividedBy(100);
}

export interface YieldTaxes {
  iof: FinDecimal;
  incomeTax: FinDecimal;
}

/**
 * Tributos sobre um rendimento: IOF primeiro; o IR incide sobre o rendimento
 * já descontado do IOF. Isentos (LCI/LCA) não pagam IR. O IOF é aplicado a
 * TODOS os tipos (estimativa conservadora — ver FINANCIAL_RULES.md).
 * Rendimento ≤ 0 não gera tributo.
 */
export function taxesOnYield(yieldAmount: FinDecimal, days: number, taxExempt: boolean): YieldTaxes {
  if (yieldAmount.lte(0)) return { iof: new FinDecimal(0), incomeTax: new FinDecimal(0) };
  const iof = yieldAmount.times(iofRate(days));
  const incomeTax = taxExempt ? new FinDecimal(0) : yieldAmount.minus(iof).times(incomeTaxRate(days));
  return { iof, incomeTax };
}
