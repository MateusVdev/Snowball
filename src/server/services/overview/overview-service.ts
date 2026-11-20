import type { Database } from "@/server/db/factory";
import { todayIsoDate } from "@/domain/dates";
import { quoteAsOf } from "@/domain/quotes";
import { FinDecimal, roundMoney, toDecimal } from "@/domain/money";
import {
  allocation,
  monthlyFlows,
  portfolioHistory,
  type AllocationSlice,
  type MonthlyFlow,
  type PortfolioHistoryPoint,
} from "@/domain/portfolio/history";
import { getDividendsOverview, type DividendsOverview } from "../dividends/dividend-service";
import { loadFundLedgers } from "../dividends/eligibility";
import { getPortfolio, type PortfolioView } from "../portfolio/fund-service";

/**
 * Visão geral consolidada — tudo calculado a partir do banco, reaproveitando
 * os serviços das etapas anteriores (carteira, proventos, ledger).
 */

export interface RecurringIncome {
  /** Σ cotas atuais × último rendimento oficial pago por cota. Estimativa, não garantia. */
  total: FinDecimal;
  byFund: { fundId: string; ticker: string; quantity: FinDecimal; lastRate: string | null; amount: FinDecimal | null }[];
  fundsWithoutHistory: number;
}

export interface Overview {
  todayIso: string;
  portfolio: PortfolioView;
  totalShares: FinDecimal;
  dividends: DividendsOverview;
  dividendsThisYear: FinDecimal;
  recurringIncome: RecurringIncome;
  history: PortfolioHistoryPoint[];
  flows: MonthlyFlow[];
  /** Saldos iniciais (sem data) — entram no investido, não nos aportes mensais. */
  initialBalancesCost: FinDecimal;
  byFund: AllocationSlice[];
  bySegment: AllocationSlice[];
}

export function recurringIncomeFrom(portfolio: PortfolioView, dividends: DividendsOverview): RecurringIncome {
  let total = new FinDecimal(0);
  let without = 0;
  const byFund = portfolio.positions
    .filter((p) => !p.archivedAt && p.metrics.quantity.gt(0))
    .map((p) => {
      const lastPaid = dividends.events
        .filter((e) => e.fundId === p.fundId && e.kind === "OFFICIAL" && e.type === "INCOME" && e.status === "PAID")
        .sort((a, b) => b.dataCom.getTime() - a.dataCom.getTime())[0];
      if (!lastPaid) {
        without += 1;
        return { fundId: p.fundId, ticker: p.ticker, quantity: p.metrics.quantity, lastRate: null, amount: null };
      }
      const amount = roundMoney(p.metrics.quantity.times(lastPaid.ratePerShare));
      total = total.plus(amount);
      return { fundId: p.fundId, ticker: p.ticker, quantity: p.metrics.quantity, lastRate: lastPaid.ratePerShare, amount };
    });
  return { total, byFund, fundsWithoutHistory: without };
}

export async function getOverview(
  db: Database,
  userId: string,
  options: { todayIso?: string; staleAfterBusinessHours?: number } = {},
): Promise<Overview> {
  const todayIso = options.todayIso ?? todayIsoDate();
  const portfolio = await getPortfolio(db, userId, { staleAfterBusinessHours: options.staleAfterBusinessHours });
  const prices = new Map(
    portfolio.positions.map((p) => [p.fundId, { price: p.metrics.currentPrice?.toFixed() ?? null, averagePrice: p.metrics.averagePrice?.toFixed() ?? null }]),
  );
  const dividends = await getDividendsOverview(db, userId, { todayIso, prices });
  const active = portfolio.positions.filter((p) => !p.archivedAt);
  const fundIds = portfolio.positions.map((p) => p.fundId);

  const [ledgers, quotes, closes, ops] = await Promise.all([
    loadFundLedgers(db, fundIds),
    db.priceQuote.findMany({ where: { fundId: { in: fundIds } }, select: { fundId: true, price: true, source: true, marketTime: true, referenceDate: true, recordedAt: true } }),
    db.dailyPrice.findMany({ where: { fundId: { in: fundIds } }, select: { fundId: true, date: true, close: true } }),
    db.operation.findMany({ where: { userId, status: "ACTIVE" }, select: { type: true, tradeDate: true, netAmount: true } }),
  ]);

  const history = portfolioHistory(
    portfolio.positions.map((p) => ({
      fundId: p.fundId,
      ticker: p.ticker,
      operations: ledgers.get(p.fundId)?.operations ?? [],
      initialBalanceKnownSince: ledgers.get(p.fundId)?.initialBalanceKnownSince ?? null,
      prices: [
        ...quotes.filter((q) => q.fundId === p.fundId).map((q) => ({ asOf: quoteAsOf(q), price: q.price.toString() })),
        ...closes.filter((c) => c.fundId === p.fundId).map((c) => ({ asOf: new Date(c.date.getTime() + 21 * 3600 * 1000), price: c.close.toString() })),
      ],
    })),
    todayIso,
  );

  const positionValue = (p: PortfolioView["positions"][number]) => p.metrics.currentValue ?? p.metrics.investedCapital;
  return {
    todayIso,
    portfolio,
    totalShares: active.reduce((a, p) => a.plus(p.metrics.quantity), new FinDecimal(0)),
    dividends,
    dividendsThisYear: dividends.income.yearly.find((y) => y.year === Number(todayIso.slice(0, 4)))?.total ?? new FinDecimal(0),
    recurringIncome: recurringIncomeFrom(portfolio, dividends),
    history,
    flows: monthlyFlows(ops.map((o) => ({ ...o, netAmount: o.netAmount.toString() }))),
    initialBalancesCost: ops.filter((o) => o.type === "INITIAL_BALANCE").reduce((a, o) => a.plus(toDecimal(o.netAmount.toString())), new FinDecimal(0)),
    byFund: allocation(active.map((p) => ({ key: p.fundId, label: p.ticker, value: positionValue(p) }))),
    bySegment: allocation(active.map((p) => ({ key: p.segment ?? "—", label: p.segment ?? "Segmento não informado", value: positionValue(p) }))),
  };
}
