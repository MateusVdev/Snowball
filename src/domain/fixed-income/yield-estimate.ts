import { FinDecimal, toDecimal, type DecimalInput } from "@/domain/money";
import { businessDaysBetween, calendarDaysBetween, type IsoDate } from "./calendar";
import type { FixedIncomeResult, FixedIncomeTerms } from "./engine";
import { incomeTaxRate } from "./taxes";

/**
 * "Quanto rende" — ESTIMATIVAS a partir do saldo bruto atual e da última taxa
 * diária conhecida do CDI/Selic (ver FINANCIAL_RULES.md):
 *
 * - por dia útil: saldo bruto × (fator diário − 1);
 * - mês até hoje: rendimento bruto do mês já calculado pelo motor;
 * - projeção do mês: até hoje + saldo × (fator^n − 1), n = dias úteis de hoje
 *   (inclusive — o rendimento de hoje ainda não entrou) até o fim do mês;
 * - líquido = bruto × (1 − alíquota de IR média dos aportes ainda investidos,
 *   ponderada pelo saldo bruto de cada um). Isento: líquido = bruto.
 * - Não inclui IOF nem aportes/resgates futuros.
 */

export interface YieldAmounts {
  gross: FinDecimal;
  net: FinDecimal;
}

export interface YieldEstimate {
  /** false quando não há taxa conhecida (valores ficam indisponíveis). */
  available: boolean;
  /** Data da taxa usada (última publicada até a data de cálculo). */
  rateDate: IsoDate | null;
  /** Taxa diária do indexador usada (% ao dia). */
  indexDailyRatePercent: FinDecimal | null;
  /** Alíquota de IR média ponderada (fração; 0 se isento). */
  incomeTaxRate: FinDecimal;
  perBusinessDay: YieldAmounts;
  monthToDate: YieldAmounts;
  monthProjection: YieldAmounts;
  /** Dias úteis restantes no mês (incluindo hoje, se útil). */
  remainingBusinessDays: number;
}

const ZERO = new FinDecimal(0);
const zero = (): YieldAmounts => ({ gross: ZERO, net: ZERO });

/** Primeiro dia do mês seguinte ao de `iso`. */
export function firstDayOfNextMonth(iso: IsoDate): IsoDate {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Fator diário do título para uma taxa do indexador (% ao dia). */
export function dailyFactor(terms: FixedIncomeTerms, indexDailyRatePercent: DecimalInput): FinDecimal {
  let f = new FinDecimal(1).plus(toDecimal(indexDailyRatePercent).dividedBy(100).times(toDecimal(terms.rate).dividedBy(100)));
  if (terms.spreadAnnualPercent !== null && !toDecimal(terms.spreadAnnualPercent).isZero()) {
    f = f.times(new FinDecimal(1).plus(toDecimal(terms.spreadAnnualPercent).dividedBy(100)).pow(new FinDecimal(1).dividedBy(252)));
  }
  return f;
}

/** Última taxa publicada com data ≤ asOf. */
export function lastKnownRate(rates: ReadonlyMap<IsoDate, DecimalInput>, asOf: IsoDate) {
  let best: IsoDate | null = null;
  for (const d of rates.keys()) if (d <= asOf && (best === null || d > best)) best = d;
  return best ? { date: best, rate: toDecimal(rates.get(best)!) } : null;
}

/** Alíquota de IR média ponderada pelo saldo bruto de cada aporte ainda investido. */
export function weightedIncomeTaxRate(result: FixedIncomeResult, taxExempt: boolean): FinDecimal {
  if (taxExempt) return ZERO;
  let weight = ZERO;
  let acc = ZERO;
  for (const lot of result.openLots) {
    weight = weight.plus(lot.gross);
    acc = acc.plus(lot.gross.times(incomeTaxRate(calendarDaysBetween(lot.date, result.asOf))));
  }
  return weight.gt(0) ? acc.dividedBy(weight) : ZERO;
}

export function estimateYield(input: {
  terms: FixedIncomeTerms;
  result: FixedIncomeResult;
  rates: ReadonlyMap<IsoDate, DecimalInput>;
}): YieldEstimate {
  const { terms, result } = input;
  const asOf = result.asOf;
  const ir = weightedIncomeTaxRate(result, terms.taxExempt);
  const net = (gross: FinDecimal): YieldAmounts => ({ gross, net: gross.times(new FinDecimal(1).minus(ir)) });
  const remaining = businessDaysBetween(asOf, firstDayOfNextMonth(asOf)).length;
  const last = lastKnownRate(input.rates, asOf);
  const monthToDate = net(result.monthEarnings);
  if (!last) {
    return {
      available: false, rateDate: null, indexDailyRatePercent: null, incomeTaxRate: ir,
      perBusinessDay: zero(), monthToDate, monthProjection: zero(), remainingBusinessDays: remaining,
    };
  }
  const f = dailyFactor(terms, last.rate);
  const gross = result.current.gross;
  return {
    available: true,
    rateDate: last.date,
    indexDailyRatePercent: last.rate,
    incomeTaxRate: ir,
    perBusinessDay: net(gross.times(f.minus(1))),
    monthToDate,
    monthProjection: net(result.monthEarnings.plus(gross.times(f.pow(remaining).minus(1)))),
    remainingBusinessDays: remaining,
  };
}

/** Soma das estimativas de vários títulos (o líquido soma os líquidos de cada um). */
export function sumYieldEstimates(list: readonly YieldEstimate[]) {
  const add = (a: YieldAmounts, b: YieldAmounts) => ({ gross: a.gross.plus(b.gross), net: a.net.plus(b.net) });
  return list.reduce(
    (acc, e) => ({
      available: acc.available || e.available,
      perBusinessDay: add(acc.perBusinessDay, e.perBusinessDay),
      monthToDate: add(acc.monthToDate, e.monthToDate),
      monthProjection: add(acc.monthProjection, e.monthProjection),
      rateDate: e.rateDate && (!acc.rateDate || e.rateDate < acc.rateDate) ? e.rateDate : acc.rateDate,
    }),
    { available: false, perBusinessDay: zero(), monthToDate: zero(), monthProjection: zero(), rateDate: null as IsoDate | null },
  );
}
