import { FinDecimal, toDecimal, type DecimalInput } from "@/domain/money";
import { addDays, calendarDaysBetween, isBusinessDay, type IsoDate } from "./calendar";
import { taxesOnYield } from "./taxes";

/**
 * Motor de renda fixa pós-fixada (% do CDI ou da Selic) — puro e determinístico.
 * Todos os resultados são ESTIMATIVAS (ver DOCUMENTATION/FINANCIAL_RULES.md).
 *
 * Convenções:
 * - Fator do dia útil d: 1 + (taxa_d% / 100) × (rate / 100); com spread anual s:
 *   × (1 + s/100)^(1/252).
 * - Cada aporte rende da sua data (INCLUSIVE) até a data de cálculo (EXCLUSIVE),
 *   somente em dias úteis: valor = aporte × Π fator_d.
 * - Dia útil sem taxa publicada: usa a última taxa conhecida anterior
 *   ("projeção"). Antes da primeira taxa conhecida: não rende ("sem índice").
 * - Movimentos do mesmo dia: aportes antes de resgates.
 * - Resgate informado pelo valor LÍQUIDO recebido: os aportes são consumidos do
 *   mais antigo para o mais novo (FIFO). Para cada aporte, calcula-se o valor
 *   líquido que ele renderia se resgatado na data (bruto − IOF − IR). Consome-se
 *   aporte inteiro enquanto o líquido pedido for maior; no último, a fração
 *   f = líquido restante ÷ líquido do aporte. O bruto equivalente é a soma dos
 *   brutos consumidos (f × bruto do aporte).
 * - IOF (dias corridos < 30) incide primeiro; o IR regressivo incide sobre o
 *   rendimento menos o IOF. Isentos (LCI/LCA) não pagam IR.
 */

export interface FixedIncomeTerms {
  /** Percentual do indexador (115 = 115% do CDI). */
  rate: DecimalInput;
  spreadAnnualPercent: DecimalInput | null;
  taxExempt: boolean;
}

export interface FixedIncomeMovementInput {
  id: string;
  type: "DEPOSIT" | "WITHDRAWAL";
  date: IsoDate;
  /** Aporte: valor aplicado. Resgate: valor LÍQUIDO recebido. */
  amount: DecimalInput;
  /** Desempate para movimentos do mesmo dia e tipo (ordem de registro). */
  order?: number;
}

export interface WithdrawalBreakdown {
  movementId: string;
  date: IsoDate;
  net: FinDecimal;
  /** Bruto equivalente (antes de IOF e IR). */
  gross: FinDecimal;
  /** Valor aplicado (principal) consumido pelo resgate. */
  principal: FinDecimal;
  iof: FinDecimal;
  incomeTax: FinDecimal;
  /** Parte do líquido pedido que excedeu o saldo líquido estimado (0 = coube). */
  excess: FinDecimal;
}

export interface Valuation {
  date: IsoDate;
  /** Valor aplicado ainda investido (principal dos aportes restantes). */
  principal: FinDecimal;
  gross: FinDecimal;
  iof: FinDecimal;
  incomeTax: FinDecimal;
  /** Se resgatasse tudo na data: bruto − IOF − IR. */
  net: FinDecimal;
}

export interface MonthEvolution {
  month: string; // AAAA-MM
  deposits: FinDecimal;
  withdrawalsNet: FinDecimal;
  withdrawalsGross: FinDecimal;
  end: Valuation;
  /** Rendimento bruto do mês = bruto_fim − bruto_início − aportes + resgates brutos. */
  earnings: FinDecimal;
  /** Rendimento bruto acumulado = bruto_fim + resgates brutos − aportes (até o fim do mês). */
  accumulatedEarnings: FinDecimal;
  projected: boolean;
  missingIndex: boolean;
}

export interface FixedIncomeResult {
  asOf: IsoDate;
  current: Valuation;
  totalDeposited: FinDecimal;
  totalWithdrawnNet: FinDecimal;
  totalWithdrawnGross: FinDecimal;
  accumulatedEarnings: FinDecimal;
  /** Rendimento bruto do mês corrente (até asOf). */
  monthEarnings: FinDecimal;
  withdrawals: WithdrawalBreakdown[];
  months: MonthEvolution[];
  /** Última data com taxa publicada (null = nenhuma). */
  ratesKnownUntil: IsoDate | null;
  /** Dias úteis calculados com a última taxa conhecida (projeção). */
  projectedBusinessDays: number;
  /** Dias úteis sem nenhuma taxa conhecida (não renderam). */
  missingBusinessDays: number;
  /** Aportes ainda investidos na data (FIFO), com o valor bruto de cada um. */
  openLots: { movementId: string; date: IsoDate; principal: FinDecimal; gross: FinDecimal }[];
}

export class FixedIncomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixedIncomeError";
  }
}

const ZERO = new FinDecimal(0);

interface Lot {
  movementId: string;
  date: IsoDate;
  principal: FinDecimal;
}

/**
 * Índice acumulado por dia: index(d) = Π fatores dos dias úteis < d.
 * O fator entre a e b é index(b) / index(a).
 */
export class DailyIndex {
  private readonly index = new Map<IsoDate, FinDecimal>();
  private readonly projected = new Set<IsoDate>();
  private readonly missing = new Set<IsoDate>();
  readonly knownUntil: IsoDate | null;

  constructor(
    readonly start: IsoDate,
    readonly end: IsoDate,
    terms: FixedIncomeTerms,
    rates: ReadonlyMap<IsoDate, DecimalInput>,
  ) {
    const known = [...rates.keys()].sort();
    this.knownUntil = known.length ? known[known.length - 1] : null;
    const pct = toDecimal(terms.rate).dividedBy(100);
    const spread =
      terms.spreadAnnualPercent !== null && !toDecimal(terms.spreadAnnualPercent).isZero()
        ? new FinDecimal(1).plus(toDecimal(terms.spreadAnnualPercent).dividedBy(100)).pow(new FinDecimal(1).dividedBy(252))
        : null;
    // Última taxa conhecida anterior a `start` (para projetar lacunas).
    let last: FinDecimal | null = null;
    for (const d of known) {
      if (d >= start) break;
      last = toDecimal(rates.get(d)!);
    }
    let acc = new FinDecimal(1);
    for (let d = start; d <= end; d = addDays(d, 1)) {
      this.index.set(d, acc);
      if (!isBusinessDay(d)) continue;
      const published = rates.get(d);
      let dayRate: FinDecimal | null;
      if (published !== undefined) {
        dayRate = toDecimal(published);
        last = dayRate;
      } else if (last) {
        dayRate = last;
        this.projected.add(d);
      } else {
        dayRate = null;
        this.missing.add(d);
      }
      if (dayRate) {
        let factor = new FinDecimal(1).plus(dayRate.dividedBy(100).times(pct));
        if (spread) factor = factor.times(spread);
        acc = acc.times(factor);
      }
    }
  }

  at(d: IsoDate): FinDecimal {
    const v = this.index.get(d);
    if (!v) throw new FixedIncomeError(`Data fora do intervalo do índice: ${d}`);
    return v;
  }

  factor(from: IsoDate, to: IsoDate): FinDecimal {
    return this.at(to).dividedBy(this.at(from));
  }

  /** Dias úteis projetados/sem índice em [from, to). */
  flags(from: IsoDate, to: IsoDate) {
    let projected = 0;
    let missing = 0;
    for (const d of this.projected) if (d >= from && d < to) projected += 1;
    for (const d of this.missing) if (d >= from && d < to) missing += 1;
    return { projected, missing };
  }
}

function sortMovements(movements: readonly FixedIncomeMovementInput[]) {
  return [...movements].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.type === b.type ? 0 : a.type === "DEPOSIT" ? -1 : 1) ||
      (a.order ?? 0) - (b.order ?? 0),
  );
}

/** Valor bruto, tributos e líquido de um aporte se resgatado inteiro em `date`. */
function lotAt(lot: Lot, date: IsoDate, idx: DailyIndex, taxExempt: boolean) {
  const gross = lot.principal.times(idx.factor(lot.date, date));
  const days = calendarDaysBetween(lot.date, date);
  const { iof, incomeTax } = taxesOnYield(gross.minus(lot.principal), days, taxExempt);
  return { gross, iof, incomeTax, net: gross.minus(iof).minus(incomeTax) };
}

function valueLots(lots: readonly Lot[], date: IsoDate, idx: DailyIndex, taxExempt: boolean): Valuation {
  let principal = ZERO;
  let gross = ZERO;
  let iof = ZERO;
  let incomeTax = ZERO;
  for (const lot of lots) {
    const v = lotAt(lot, date, idx, taxExempt);
    principal = principal.plus(lot.principal);
    gross = gross.plus(v.gross);
    iof = iof.plus(v.iof);
    incomeTax = incomeTax.plus(v.incomeTax);
  }
  return { date, principal, gross, iof, incomeTax, net: gross.minus(iof).minus(incomeTax) };
}

/** Consome aportes (FIFO) para um resgate de valor LÍQUIDO `net` na data `date`. */
export function consumeFifo(
  lots: Lot[],
  movementId: string,
  date: IsoDate,
  net: FinDecimal,
  idx: DailyIndex,
  taxExempt: boolean,
): WithdrawalBreakdown {
  let remaining = net;
  const out = { gross: ZERO, principal: ZERO, iof: ZERO, incomeTax: ZERO };
  while (remaining.gt(0) && lots.length) {
    const lot = lots[0];
    const v = lotAt(lot, date, idx, taxExempt);
    if (v.net.lte(0)) {
      lots.shift();
      continue;
    }
    const fraction = remaining.gte(v.net) ? new FinDecimal(1) : remaining.dividedBy(v.net);
    out.gross = out.gross.plus(v.gross.times(fraction));
    out.principal = out.principal.plus(lot.principal.times(fraction));
    out.iof = out.iof.plus(v.iof.times(fraction));
    out.incomeTax = out.incomeTax.plus(v.incomeTax.times(fraction));
    remaining = remaining.minus(v.net.times(fraction));
    if (fraction.eq(1)) lots.shift();
    else lot.principal = lot.principal.times(new FinDecimal(1).minus(fraction));
  }
  return { movementId, date, net, ...out, excess: FinDecimal.max(remaining, 0) };
}

function monthAfter(month: string): IsoDate {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * Calcula a posição na data `asOf` (exclusive para o rendimento; movimentos
 * com data ≤ asOf são considerados) e a evolução mês a mês.
 */
export function computeFixedIncome(input: {
  terms: FixedIncomeTerms;
  movements: readonly FixedIncomeMovementInput[];
  /** Taxas diárias publicadas (% do dia), por data. */
  rates: ReadonlyMap<IsoDate, DecimalInput>;
  asOf: IsoDate;
}): FixedIncomeResult {
  const { terms, asOf } = input;
  const moves = sortMovements(input.movements.filter((m) => m.date <= asOf));
  for (const m of moves) {
    if (toDecimal(m.amount).lte(0)) throw new FixedIncomeError("Valores de movimentos devem ser positivos.");
  }
  if (toDecimal(terms.rate).lte(0)) throw new FixedIncomeError("A taxa (% do indexador) deve ser positiva.");

  const empty: Valuation = { date: asOf, principal: ZERO, gross: ZERO, iof: ZERO, incomeTax: ZERO, net: ZERO };
  const knownUntil = [...input.rates.keys()].sort().at(-1) ?? null;
  if (moves.length === 0) {
    return {
      asOf, current: empty, totalDeposited: ZERO, totalWithdrawnNet: ZERO, totalWithdrawnGross: ZERO,
      accumulatedEarnings: ZERO, monthEarnings: ZERO, withdrawals: [], months: [], ratesKnownUntil: knownUntil,
      projectedBusinessDays: 0, missingBusinessDays: 0, openLots: [],
    };
  }

  const start = moves[0].date;
  const idx = new DailyIndex(start, asOf, terms, input.rates);
  const lots: Lot[] = [];
  const withdrawals: WithdrawalBreakdown[] = [];
  let deposited = ZERO;
  let withdrawnNet = ZERO;
  let withdrawnGross = ZERO;
  let pointer = 0;

  const advance = (until: IsoDate, inclusive: boolean) => {
    const acc = { deposits: ZERO, net: ZERO, gross: ZERO };
    while (pointer < moves.length && (inclusive ? moves[pointer].date <= until : moves[pointer].date < until)) {
      const m = moves[pointer++];
      const amount = toDecimal(m.amount);
      if (m.type === "DEPOSIT") {
        lots.push({ movementId: m.id, date: m.date, principal: amount });
        deposited = deposited.plus(amount);
        acc.deposits = acc.deposits.plus(amount);
      } else {
        const w = consumeFifo(lots, m.id, m.date, amount, idx, terms.taxExempt);
        withdrawals.push(w);
        withdrawnNet = withdrawnNet.plus(amount);
        withdrawnGross = withdrawnGross.plus(w.gross);
        acc.net = acc.net.plus(amount);
        acc.gross = acc.gross.plus(w.gross);
      }
    }
    return acc;
  };

  const months: MonthEvolution[] = [];
  let month = start.slice(0, 7);
  let previousGross = ZERO;
  for (;;) {
    const next = monthAfter(month);
    const isLast = next > asOf;
    const boundary = isLast ? asOf : next;
    const flows = advance(boundary, isLast);
    const end = valueLots(lots, boundary, idx, terms.taxExempt);
    const flags = idx.flags(`${month}-01` < start ? start : `${month}-01`, boundary);
    months.push({
      month,
      deposits: flows.deposits,
      withdrawalsNet: flows.net,
      withdrawalsGross: flows.gross,
      end,
      earnings: end.gross.minus(previousGross).minus(flows.deposits).plus(flows.gross),
      accumulatedEarnings: end.gross.plus(withdrawnGross).minus(deposited),
      projected: flags.projected > 0,
      missingIndex: flags.missing > 0,
    });
    previousGross = end.gross;
    if (isLast) break;
    month = next.slice(0, 7);
  }

  const current = months[months.length - 1].end;
  const flags = idx.flags(start, asOf);
  return {
    asOf,
    current,
    totalDeposited: deposited,
    totalWithdrawnNet: withdrawnNet,
    totalWithdrawnGross: withdrawnGross,
    accumulatedEarnings: current.gross.plus(withdrawnGross).minus(deposited),
    monthEarnings: months[months.length - 1].month === asOf.slice(0, 7) ? months[months.length - 1].earnings : ZERO,
    withdrawals,
    months,
    ratesKnownUntil: idx.knownUntil,
    projectedBusinessDays: flags.projected,
    missingBusinessDays: flags.missing,
    openLots: lots.map((lot) => ({
      movementId: lot.movementId,
      date: lot.date,
      principal: lot.principal,
      gross: lot.principal.times(idx.factor(lot.date, asOf)),
    })),
  };
}
