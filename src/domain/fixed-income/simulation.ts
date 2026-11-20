import { FinDecimal, toDecimal, type DecimalInput } from "@/domain/money";
import { addDays, businessDaysBetween, isBusinessDay, type IsoDate } from "./calendar";
import { DailyIndex, valueLots, type Lot, type Valuation } from "./engine";

/**
 * Simulador de renda fixa com aportes mensais — ESTIMATIVA.
 *
 * Reaproveita o motor de renda fixa (DailyIndex + IR/IOF por aporte):
 * - o indexador anual informado vira uma taxa diária constante
 *   d = (1 + a)^(1/252) − 1, aplicada somente nos dias úteis do calendário;
 * - "% do CDI": fator diário = 1 + d_CDI × percentual;
 *   "taxa anual": fator diário = 1 + d_taxa (equivale a 100% de um índice = taxa);
 * - o valor inicial é aplicado na data de início; o aporte mensal é feito no
 *   início de cada mês da simulação (mês 1 inclusive) — no mesmo dia do mês da
 *   data de início (ou no último dia do mês, se ele não existir), passando para
 *   o próximo dia útil quando cair em fim de semana/feriado;
 * - o mês k termina em início + k meses; a posição no fim do mês considera os
 *   aportes feitos ANTES dessa data (o aporte do mês seguinte entra no outro mês);
 * - cada aporte tem o seu próprio prazo de IR (regressivo) e de IOF (< 30 dias);
 *   isento = sem IR.
 */

export const MAX_SIMULATION_MONTHS = 360;

export interface FixedIncomeSimulationParams {
  initialAmount: DecimalInput;
  monthlyContribution: DecimalInput;
  months: number;
  rateMode: "CDI_PERCENT" | "ANNUAL_FIXED";
  /** % do CDI (115 = 115%). Usado em CDI_PERCENT. */
  cdiPercent: DecimalInput | null;
  /** Taxa anual em % (12 = 12% a.a.). Usado em ANNUAL_FIXED. */
  annualRatePercent: DecimalInput | null;
  /** CDI anual estimado em % (14,9 = 14,9% a.a.). Usado em CDI_PERCENT. */
  cdiAnnualPercent: DecimalInput | null;
  taxExempt: boolean;
  startDate: IsoDate;
}

export interface SimulationMonth {
  month: number;
  date: IsoDate;
  /** Total aplicado até o fim do mês. */
  totalApplied: FinDecimal;
  contribution: FinDecimal;
  /** Rendimento bruto do mês. */
  earnings: FinDecimal;
  /** Rendimento bruto acumulado. */
  accumulatedEarnings: FinDecimal;
  gross: FinDecimal;
  incomeTax: FinDecimal;
  iof: FinDecimal;
  /** Valor líquido se resgatasse tudo no fim do mês. */
  net: FinDecimal;
}

export interface SimulationSummary {
  months: number;
  totalApplied: FinDecimal;
  gross: FinDecimal;
  incomeTax: FinDecimal;
  iof: FinDecimal;
  net: FinDecimal;
  /** Rendimento líquido = líquido − aplicado. */
  netEarnings: FinDecimal;
  /** Taxa diária do índice usada (% ao dia). */
  dailyRatePercent: FinDecimal;
}

export interface SimulationResult {
  rows: SimulationMonth[];
  summary: SimulationSummary;
}

export class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationError";
  }
}

/** Taxa anual (% a.a.) → taxa diária (% ao dia), base 252 dias úteis. */
export function annualToDailyPercent(annualPercent: DecimalInput): FinDecimal {
  const a = toDecimal(annualPercent).dividedBy(100);
  return new FinDecimal(1).plus(a).pow(new FinDecimal(1).dividedBy(252)).minus(1).times(100);
}

/** Taxa diária (% ao dia) → taxa anual (% a.a.), base 252 dias úteis. */
export function dailyToAnnualPercent(dailyPercent: DecimalInput): FinDecimal {
  return new FinDecimal(1).plus(toDecimal(dailyPercent).dividedBy(100)).pow(252).minus(1).times(100);
}

/** Mesma data `k` meses depois (dia limitado ao último dia do mês). */
export function addMonths(iso: IsoDate, k: number): IsoDate {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + k;
  const day = Number(iso.slice(8, 10));
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** Próximo dia útil (a própria data, se útil). */
export function nextBusinessDay(iso: IsoDate): IsoDate {
  let d = iso;
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}

export function simulateFixedIncome(p: FixedIncomeSimulationParams): SimulationResult {
  if (!Number.isInteger(p.months) || p.months < 1 || p.months > MAX_SIMULATION_MONTHS) {
    throw new SimulationError(`O prazo deve ser de 1 a ${MAX_SIMULATION_MONTHS} meses.`);
  }
  const initial = toDecimal(p.initialAmount);
  const monthly = toDecimal(p.monthlyContribution);
  if (initial.isNegative() || monthly.isNegative()) throw new SimulationError("Valores não podem ser negativos.");
  if (initial.plus(monthly).lte(0)) throw new SimulationError("Informe um valor inicial ou um aporte mensal.");

  let dailyRatePercent: FinDecimal;
  let percent: DecimalInput;
  if (p.rateMode === "CDI_PERCENT") {
    if (p.cdiPercent === null || toDecimal(p.cdiPercent).lte(0)) throw new SimulationError("Informe o % do CDI.");
    if (p.cdiAnnualPercent === null || toDecimal(p.cdiAnnualPercent).lte(0)) throw new SimulationError("Informe o CDI anual estimado.");
    dailyRatePercent = annualToDailyPercent(p.cdiAnnualPercent);
    percent = p.cdiPercent;
  } else {
    if (p.annualRatePercent === null || toDecimal(p.annualRatePercent).lte(0)) throw new SimulationError("Informe a taxa anual.");
    dailyRatePercent = annualToDailyPercent(p.annualRatePercent);
    percent = 100;
  }

  const start = p.startDate;
  const end = addMonths(start, p.months);
  const rates = new Map<IsoDate, FinDecimal>(businessDaysBetween(start, end).map((d) => [d, dailyRatePercent]));
  const idx = new DailyIndex(start, end, { rate: percent, spreadAnnualPercent: null, taxExempt: p.taxExempt }, rates);

  // Aportes: inicial na data de início; mensal no início de cada mês (1..N).
  const deposits: Lot[] = [];
  if (initial.gt(0)) deposits.push({ movementId: "inicial", date: start, principal: initial });
  if (monthly.gt(0)) {
    for (let k = 0; k < p.months; k++) {
      const date = nextBusinessDay(addMonths(start, k));
      if (date < end) deposits.push({ movementId: `aporte-${k + 1}`, date, principal: monthly });
    }
  }

  const rows: SimulationMonth[] = [];
  let previousGross = new FinDecimal(0);
  let applied = new FinDecimal(0);
  let pointer = 0;
  const open: Lot[] = [];
  for (let k = 1; k <= p.months; k++) {
    const date = addMonths(start, k);
    let contribution = new FinDecimal(0);
    while (pointer < deposits.length && deposits[pointer].date < date) {
      const lot = deposits[pointer++];
      open.push(lot);
      contribution = contribution.plus(lot.principal);
    }
    applied = applied.plus(contribution);
    const v: Valuation = valueLots(open, date, idx, p.taxExempt);
    rows.push({
      month: k,
      date,
      totalApplied: applied,
      contribution,
      earnings: v.gross.minus(previousGross).minus(contribution),
      accumulatedEarnings: v.gross.minus(applied),
      gross: v.gross,
      incomeTax: v.incomeTax,
      iof: v.iof,
      net: v.net,
    });
    previousGross = v.gross;
  }
  const last = rows[rows.length - 1];
  return {
    rows,
    summary: {
      months: p.months,
      totalApplied: last.totalApplied,
      gross: last.gross,
      incomeTax: last.incomeTax,
      iof: last.iof,
      net: last.net,
      netEarnings: last.net.minus(last.totalApplied),
      dailyRatePercent,
    },
  };
}
