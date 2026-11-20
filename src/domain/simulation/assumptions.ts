import { FinDecimal, roundMoney, roundTo, toDecimal } from "@/domain/money";
import type { GrowthRule, ValueChange } from "./types";

/**
 * Premissas de preço e dividendo por mês (puras e determinísticas).
 *
 * valor(m) = base × (1 + taxa)^n, onde a base é o valor inicial ou o da última
 * alteração manual com mês ≤ m, e n conta os períodos desde essa base:
 * - MONTHLY: n = m − mês_base
 * - ANNUAL:  n = ⌊(m − 1)/12⌋ − ⌊(mês_base − 1)/12⌋ (vira nos meses 13, 25, …)
 * - CONSTANT: n = 0
 * Preço é arredondado a centavos (preço de mercado); dividendo por cota a 8 casas.
 */
export function valueAt(
  initial: string,
  rule: GrowthRule,
  changes: readonly ValueChange[],
  month: number,
): FinDecimal {
  let base = toDecimal(initial);
  let baseMonth = 1;
  for (const c of [...changes].sort((a, b) => a.month - b.month)) {
    if (c.month <= month) {
      base = toDecimal(c.value);
      baseMonth = c.month;
    }
  }
  if (rule.mode === "CONSTANT") return base;
  const rate = toDecimal(rule.ratePercent).dividedBy(100);
  const n =
    rule.mode === "MONTHLY"
      ? month - baseMonth
      : Math.floor((month - 1) / 12) - Math.floor((baseMonth - 1) / 12);
  if (n <= 0) return base;
  return base.times(new FinDecimal(1).plus(rate).pow(n));
}

export function priceAt(initial: string, rule: GrowthRule, changes: readonly ValueChange[], month: number) {
  return roundMoney(valueAt(initial, rule, changes, month));
}

export function dividendPerShareAt(initial: string, rule: GrowthRule, changes: readonly ValueChange[], month: number) {
  return roundTo(valueAt(initial, rule, changes, month), 8);
}

/**
 * Divide um valor em reais por pesos (%), exatamente em centavos: cada parte
 * é truncada a centavos e os centavos restantes vão, um a um, para as maiores
 * frações (empate: ordem das chaves). A soma das partes é sempre o total.
 */
export function splitByWeights(
  amount: FinDecimal,
  weights: readonly { key: string; weight: FinDecimal }[],
): Map<string, FinDecimal> {
  const out = new Map<string, FinDecimal>();
  const positive = weights.filter((w) => w.weight.gt(0));
  const totalWeight = positive.reduce((a, w) => a.plus(w.weight), new FinDecimal(0));
  if (amount.isZero() || totalWeight.isZero()) {
    for (const w of weights) out.set(w.key, new FinDecimal(0));
    return out;
  }
  const cents = amount.times(100);
  const parts = positive.map((w, index) => {
    const exact = cents.times(w.weight).dividedBy(totalWeight);
    const floor = exact.floor();
    return { key: w.key, floor, frac: exact.minus(floor), index };
  });
  let remaining = cents.minus(parts.reduce((a, p) => a.plus(p.floor), new FinDecimal(0)));
  const order = [...parts].sort((a, b) => b.frac.comparedTo(a.frac) || a.index - b.index);
  for (const p of order) {
    if (remaining.lte(0)) break;
    p.floor = p.floor.plus(1);
    remaining = remaining.minus(1);
  }
  for (const w of weights) out.set(w.key, new FinDecimal(0));
  for (const p of parts) out.set(p.key, p.floor.dividedBy(100));
  return out;
}
