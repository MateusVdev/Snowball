import { toIsoDate } from "@/domain/dates";
import { FinDecimal, toDecimal, type DecimalInput } from "@/domain/money";
import { replayLedger, type LedgerOperationInput } from "./ledger";

/**
 * Evolução da carteira ao longo do tempo, reconstruída a partir do banco
 * (operações + cotações registradas). Regras:
 * - posição em uma data = reprocessamento das operações com pregão ≤ data;
 * - o saldo inicial (sem data) só é conhecido a partir do dia em que foi
 *   registrado; antes disso a posição do fundo é DESCONHECIDA;
 * - preço em uma data = cotação/fechamento mais recente com referência ≤ data;
 * - faltando posição ou preço de algum fundo com cotas, o valor de mercado do
 *   mês fica indisponível (null) — nunca é estimado.
 */

export interface FundHistoryInput {
  fundId: string;
  ticker: string;
  operations: LedgerOperationInput[];
  initialBalanceKnownSince: Date | null;
  /** Preços conhecidos (qualquer fonte) com o instante a que se referem. */
  prices: { asOf: Date; price: DecimalInput }[];
}

export interface LedgerStateAt {
  quantity: FinDecimal;
  totalCost: FinDecimal;
}

/** Estado do livro-razão ao fim do dia `date` (null = desconhecido). */
export function ledgerStateAt(
  operations: readonly LedgerOperationInput[],
  date: Date,
  initialBalanceKnownSince: Date | null,
): LedgerStateAt | null {
  const iso = toIsoDate(date);
  const hasInitial = operations.some((o) => o.type === "INITIAL_BALANCE");
  if (hasInitial && (!initialBalanceKnownSince || toIsoDate(initialBalanceKnownSince) > iso)) return null;
  const ops = operations.filter((o) => o.type === "INITIAL_BALANCE" || (o.tradeDate && toIsoDate(o.tradeDate) <= iso));
  const { final } = replayLedger(ops);
  return { quantity: final.quantity, totalCost: final.totalCost };
}

/** Preço mais recente com referência até o fim do dia (horário de São Paulo ≈ 23:59 = 02:59Z do dia seguinte). */
export function priceAt(prices: FundHistoryInput["prices"], date: Date): FinDecimal | null {
  const limit = date.getTime() + 27 * 3600 * 1000 - 1;
  let best: { t: number; p: DecimalInput } | null = null;
  for (const p of prices) {
    const t = p.asOf.getTime();
    if (t <= limit && (!best || t > best.t)) best = { t, p: p.price };
  }
  return best ? toDecimal(best.p) : null;
}

export interface PortfolioHistoryPoint {
  /** "AAAA-MM" */
  month: string;
  /** Data de referência do ponto (último dia do mês ou hoje). */
  date: Date;
  investedCapital: FinDecimal | null;
  marketValue: FinDecimal | null;
  /** Fundos que impediram o cálculo (posição ou preço desconhecidos). */
  missing: string[];
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0));
}

export function portfolioHistory(funds: readonly FundHistoryInput[], todayIso: string): PortfolioHistoryPoint[] {
  const starts: string[] = [];
  for (const f of funds) {
    for (const o of f.operations) if (o.tradeDate) starts.push(toIsoDate(o.tradeDate));
    if (f.initialBalanceKnownSince && f.operations.some((o) => o.type === "INITIAL_BALANCE")) starts.push(toIsoDate(f.initialBalanceKnownSince));
  }
  if (starts.length === 0) return [];
  starts.sort();
  let [y, m] = starts[0].split("-").map(Number);
  const [ty, tm] = todayIso.split("-").map(Number);
  const points: PortfolioHistoryPoint[] = [];
  while (y < ty || (y === ty && m <= tm)) {
    const isCurrent = y === ty && m === tm;
    const date = isCurrent ? new Date(`${todayIso}T00:00:00Z`) : lastDayOfMonth(y, m);
    let invested = new FinDecimal(0);
    let value = new FinDecimal(0);
    let investedKnown = true;
    let valueKnown = true;
    const missing: string[] = [];
    for (const f of funds) {
      const state = ledgerStateAt(f.operations, date, f.initialBalanceKnownSince);
      if (!state) {
        investedKnown = valueKnown = false;
        missing.push(f.ticker);
        continue;
      }
      invested = invested.plus(state.totalCost);
      if (state.quantity.isZero()) continue;
      const price = priceAt(f.prices, date);
      if (!price) {
        valueKnown = false;
        missing.push(f.ticker);
        continue;
      }
      value = value.plus(state.quantity.times(price));
    }
    points.push({
      month: `${y}-${String(m).padStart(2, "0")}`,
      date,
      investedCapital: investedKnown ? invested : null,
      marketValue: valueKnown ? value : null,
      missing,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return points;
}

export interface MonthlyFlow {
  month: string;
  buys: FinDecimal;
  sells: FinDecimal;
  /** Aporte líquido = compras (com taxas) − vendas (líquidas). */
  net: FinDecimal;
}

/** Aportes por mês a partir das operações datadas ativas (saldo inicial não tem data e fica de fora). */
export function monthlyFlows(
  operations: readonly { type: "INITIAL_BALANCE" | "BUY" | "SELL"; tradeDate: Date | null; netAmount: DecimalInput }[],
): MonthlyFlow[] {
  const map = new Map<string, { buys: FinDecimal; sells: FinDecimal }>();
  for (const o of operations) {
    if (o.type === "INITIAL_BALANCE" || !o.tradeDate) continue;
    const month = toIsoDate(o.tradeDate).slice(0, 7);
    const cur = map.get(month) ?? { buys: new FinDecimal(0), sells: new FinDecimal(0) };
    if (o.type === "BUY") cur.buys = cur.buys.plus(toDecimal(o.netAmount));
    else cur.sells = cur.sells.plus(toDecimal(o.netAmount));
    map.set(month, cur);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, buys: v.buys, sells: v.sells, net: v.buys.minus(v.sells) }));
}

export interface AllocationSlice {
  key: string;
  label: string;
  value: FinDecimal;
  share: FinDecimal;
}

/** Distribuição por chave (fundo ou segmento). Usa valor de mercado; sem cotação, o capital investido. */
export function allocation(items: readonly { key: string; label: string; value: DecimalInput }[]): AllocationSlice[] {
  const grouped = new Map<string, { label: string; value: FinDecimal }>();
  for (const i of items) {
    const g = grouped.get(i.key) ?? { label: i.label, value: new FinDecimal(0) };
    g.value = g.value.plus(toDecimal(i.value));
    grouped.set(i.key, g);
  }
  const total = [...grouped.values()].reduce((a, g) => a.plus(g.value), new FinDecimal(0));
  return [...grouped.entries()]
    .map(([key, g]) => ({ key, label: g.label, value: g.value, share: total.gt(0) ? g.value.dividedBy(total) : new FinDecimal(0) }))
    .filter((s) => s.value.gt(0))
    .sort((a, b) => b.value.comparedTo(a.value) || a.label.localeCompare(b.label));
}
