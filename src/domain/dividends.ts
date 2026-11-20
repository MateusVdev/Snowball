import { FinDecimal, roundMoney, toDecimal, type DecimalInput } from "@/domain/money";
import {
  replayLedger,
  type LedgerOperationInput,
} from "@/domain/portfolio/ledger";
import { toIsoDate } from "@/domain/dates";

/**
 * Regras de proventos (puras). Ver DOCUMENTATION/FINANCIAL_RULES.md.
 *
 * Datas são "de calendário" (meia-noite UTC = dia em São Paulo).
 */

// ---------------------------------------------------------------------------
// Quantidade elegível na data-com
// ---------------------------------------------------------------------------

export type Eligibility =
  | { status: "KNOWN"; quantity: FinDecimal }
  | { status: "UNKNOWN"; reason: string };

/**
 * Quantidade de cotas com direito ao provento: posição ao FINAL da data-com,
 * reprocessando apenas as operações com data de pregão <= data-com.
 *
 * O saldo inicial não tem data de aquisição. Ele só é considerado a partir do
 * dia em que foi registrado no sistema (`initialBalanceKnownSince`): para
 * datas-com anteriores, a elegibilidade é DESCONHECIDA e precisa ser
 * confirmada pelo usuário. Nunca se usa a quantidade atual retroativamente.
 */
export function eligibleQuantityAt(
  operations: readonly LedgerOperationInput[],
  dataCom: Date,
  initialBalanceKnownSince: Date | null,
): Eligibility {
  const hasInitial = operations.some((op) => op.type === "INITIAL_BALANCE");
  if (hasInitial) {
    if (!initialBalanceKnownSince) {
      return { status: "UNKNOWN", reason: "Saldo inicial sem data de registro." };
    }
    if (toIsoDate(initialBalanceKnownSince) > toIsoDate(dataCom)) {
      return {
        status: "UNKNOWN",
        reason: `O saldo inicial foi registrado em ${toIsoDate(initialBalanceKnownSince)}, depois da data-com; não se sabe quantas cotas havia na data-com.`,
      };
    }
  }
  const dataComIso = toIsoDate(dataCom);
  const upToDate = operations.filter(
    (op) =>
      op.type === "INITIAL_BALANCE" ||
      (op.tradeDate !== null && toIsoDate(op.tradeDate) <= dataComIso),
  );
  const { final } = replayLedger(upToDate);
  return { status: "KNOWN", quantity: final.quantity };
}

/** Valor do provento: round2(quantidade × valor por cota). */
export function dividendAmount(quantity: DecimalInput, ratePerShare: DecimalInput) {
  return roundMoney(toDecimal(quantity).times(toDecimal(ratePerShare)));
}

// ---------------------------------------------------------------------------
// Status do evento
// ---------------------------------------------------------------------------

export type DividendEventStatus =
  /** Estimativa do usuário — nunca é anúncio oficial. */
  | "FORECAST"
  /** Oficial, pagamento futuro ou sem data de pagamento definida. */
  | "ANNOUNCED"
  /** Oficial, data de pagamento já passou (pago pelo fundo). */
  | "PAID";

export function dividendEventStatus(
  event: { kind: "OFFICIAL" | "FORECAST"; paymentDate: Date | null },
  todayIso: string,
): DividendEventStatus {
  if (event.kind === "FORECAST") return "FORECAST";
  if (!event.paymentDate) return "ANNOUNCED";
  return toIsoDate(event.paymentDate) > todayIso ? "ANNOUNCED" : "PAID";
}

// ---------------------------------------------------------------------------
// Competência
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/**
 * Normaliza a competência ("AAAA-MM") a partir do texto da fonte, SEM supor
 * o ano: "Outubro-2026" → "2026-10"; "10/2026" → "2026-10"; "OUTUBRO" → null.
 */
export function parseCompetence(label: string | null | undefined): string | null {
  if (!label) return null;
  const text = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  let match = /^(\d{4})-(\d{2})$/.exec(text);
  if (match) return validMonth(+match[1], +match[2]);
  match = /^(\d{1,2})\s*[/-]\s*(\d{4})$/.exec(text);
  if (match) return validMonth(+match[2], +match[1]);
  match = /^([a-z]+)\s*[/\-\s]\s*(?:de\s+)?(\d{4})$/.exec(text);
  if (match && MONTHS[match[1]]) return validMonth(+match[2], MONTHS[match[1]]);
  return null;
}

function validMonth(year: number, month: number) {
  if (year < 1990 || year > 2100 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Histórico de renda (recebimentos registrados)
// ---------------------------------------------------------------------------

export interface ReceiptInput {
  fundId: string;
  ticker: string;
  type: "INCOME" | "AMORTIZATION";
  paymentDate: Date;
  totalAmount: DecimalInput;
}

export interface IncomeSummary {
  /** Total de rendimentos recebidos (sem amortizações). */
  totalReceived: FinDecimal;
  /** Rendimentos com pagamento nos últimos 12 meses (data > hoje − 12 meses). */
  last12Months: FinDecimal;
  /** Renda passiva mensal média = últimos 12 meses ÷ 12. */
  monthlyAverage12m: FinDecimal;
  /** Média mensal desde o primeiro recebimento (meses corridos, inclusive o atual). */
  monthlyAverageSinceFirst: FinDecimal | null;
  /** Mês corrente e mês anterior (renda mensal efetiva). */
  currentMonth: FinDecimal;
  previousMonth: FinDecimal;
  amortizationTotal: FinDecimal;
  /** Série mensal contínua (com zeros) do primeiro recebimento até o mês atual. */
  monthly: { month: string; total: FinDecimal }[];
  yearly: { year: number; total: FinDecimal }[];
  byFund: { fundId: string; ticker: string; total: FinDecimal; last12Months: FinDecimal }[];
}

/** "AAAA-MM-DD" − n meses (mesmo dia, limitado ao fim do mês). */
export function minusMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

function monthRange(fromMonth: string, toMonth: string): string[] {
  const out: string[] = [];
  let [y, m] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function summarizeIncome(
  receipts: readonly ReceiptInput[],
  todayIso: string,
): IncomeSummary {
  const zero = new FinDecimal(0);
  const windowStart = minusMonthsIso(todayIso, 12);
  const currentMonth = todayIso.slice(0, 7);
  const previousMonth = minusMonthsIso(`${currentMonth}-01`, 1).slice(0, 7);

  let total = zero;
  let last12 = zero;
  let amort = zero;
  const byMonth = new Map<string, FinDecimal>();
  const byYear = new Map<number, FinDecimal>();
  const byFund = new Map<string, { fundId: string; ticker: string; total: FinDecimal; last12Months: FinDecimal }>();

  for (const r of receipts) {
    const amount = toDecimal(r.totalAmount);
    const iso = toIsoDate(r.paymentDate);
    if (iso > todayIso) continue; // pagamento futuro ainda não é renda recebida
    if (r.type === "AMORTIZATION") {
      amort = amort.plus(amount);
      continue;
    }
    total = total.plus(amount);
    const inWindow = iso > windowStart;
    if (inWindow) last12 = last12.plus(amount);
    const month = iso.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? zero).plus(amount));
    const year = Number(iso.slice(0, 4));
    byYear.set(year, (byYear.get(year) ?? zero).plus(amount));
    const f = byFund.get(r.fundId) ?? { fundId: r.fundId, ticker: r.ticker, total: zero, last12Months: zero };
    f.total = f.total.plus(amount);
    if (inWindow) f.last12Months = f.last12Months.plus(amount);
    byFund.set(r.fundId, f);
  }

  const months = [...byMonth.keys()].sort();
  const monthly = months.length
    ? monthRange(months[0], currentMonth).map((month) => ({ month, total: byMonth.get(month) ?? zero }))
    : [];

  return {
    totalReceived: total,
    last12Months: last12,
    monthlyAverage12m: last12.dividedBy(12),
    monthlyAverageSinceFirst: monthly.length ? total.dividedBy(monthly.length) : null,
    currentMonth: byMonth.get(currentMonth) ?? zero,
    previousMonth: byMonth.get(previousMonth) ?? zero,
    amortizationTotal: amort,
    monthly,
    yearly: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, t]) => ({ year, total: t })),
    byFund: [...byFund.values()].sort((a, b) => b.total.comparedTo(a.total)),
  };
}

// ---------------------------------------------------------------------------
// Dividend yield
// ---------------------------------------------------------------------------

export interface YieldEventInput {
  kind: "OFFICIAL" | "FORECAST";
  type: "INCOME" | "AMORTIZATION";
  paymentDate: Date | null;
  ratePerShare: DecimalInput;
}

export interface DividendYieldResult {
  /** Soma dos rendimentos por cota pagos nos últimos 12 meses. */
  sumPerShare12m: FinDecimal;
  eventsCount: number;
  /** null quando não há dados suficientes. Fração (0.12 = 12%). */
  dividendYield12m: FinDecimal | null;
  yieldOnCost12m: FinDecimal | null;
  /** Último rendimento por cota pago (oficial). */
  lastRatePerShare: FinDecimal | null;
  insufficientReason: string | null;
}

/**
 * DY 12m = Σ rendimentos por cota (oficiais, tipo rendimento) com pagamento
 * nos últimos 12 meses ÷ cotação atual. Exige histórico registrado que
 * cubra a janela inteira (primeiro evento conhecido no início da janela ou
 * antes) — caso contrário, "dados insuficientes". Amortizações e previsões
 * nunca entram.
 */
export function dividendYield12m(
  events: readonly YieldEventInput[],
  currentPrice: DecimalInput | null,
  averagePrice: DecimalInput | null,
  todayIso: string,
): DividendYieldResult {
  const windowStart = minusMonthsIso(todayIso, 12);
  const coverageLimit = minusMonthsIso(todayIso, 11); // tolera pagamento no 1º mês da janela
  const paid = events
    .filter((e) => e.kind === "OFFICIAL" && e.type === "INCOME" && e.paymentDate)
    .map((e) => ({ iso: toIsoDate(e.paymentDate!), rate: toDecimal(e.ratePerShare) }))
    .filter((e) => e.iso <= todayIso)
    .sort((a, b) => a.iso.localeCompare(b.iso));

  const inWindow = paid.filter((e) => e.iso > windowStart);
  const sum = inWindow.reduce((acc, e) => acc.plus(e.rate), new FinDecimal(0));
  const last = paid.at(-1)?.rate ?? null;

  let reason: string | null = null;
  if (paid.length === 0) reason = "Nenhum rendimento oficial registrado.";
  else if (paid[0].iso > coverageLimit) reason = "Histórico registrado cobre menos de 12 meses.";

  const price = currentPrice === null ? null : toDecimal(currentPrice);
  const avg = averagePrice === null ? null : toDecimal(averagePrice);
  return {
    sumPerShare12m: sum,
    eventsCount: inWindow.length,
    dividendYield12m: !reason && price && price.gt(0) ? sum.dividedBy(price) : null,
    yieldOnCost12m: !reason && avg && avg.gt(0) ? sum.dividedBy(avg) : null,
    lastRatePerShare: last,
    insufficientReason: reason ?? (price ? null : "Sem cotação."),
  };
}
