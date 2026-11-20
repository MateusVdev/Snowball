import { toDecimal } from "@/domain/money";
import type { Milestone, MonthResult, SimulationConfig } from "./types";

/**
 * Marcos detectados automaticamente (primeiro mês em que ocorrem).
 * - "Primeira cota comprada apenas com dividendos": primeira compra de uma
 *   cota integralmente paga com dinheiro de dividendos (nas compras, o dinheiro
 *   de dividendos é usado antes do dinheiro de aportes).
 * - "Primeira compra de N cotas": total de cotas compradas no mês ≥ N.
 * - "Dividendos superiores ao aporte mensal": dividendos recebidos no mês >
 *   aporte mensal regular (não se aplica sem aporte mensal).
 * - "R$ X de renda mensal": dividendos recebidos no mês ≥ X.
 */
export const INCOME_THRESHOLDS = ["50", "100", "500", "1000"] as const;

function first(rows: MonthResult[], predicate: (r: MonthResult) => boolean) {
  return rows.find(predicate)?.month ?? null;
}

export function computeMilestones(rows: MonthResult[], config: SimulationConfig): Milestone[] {
  const out: Milestone[] = [];
  const add = (key: string, label: string, month: number | null, notReached = "Não atingido no prazo.") =>
    out.push({ key, label, month, note: month === null ? notReached : null });

  add("FIRST_SHARE_FROM_DIVIDENDS", "Primeira cota comprada apenas com dividendos", first(rows, (r) => toDecimal(r.sharesBoughtWithDividendsOnly).gte(1)));
  for (const n of [2, 5, 10]) {
    add(`FIRST_BUY_${n}`, `Primeira compra de ${n} cotas no mês`, first(rows, (r) => toDecimal(r.sharesBought).gte(n)));
  }
  const regular = toDecimal(config.monthlyContribution || "0");
  if (regular.gt(0)) {
    add("DIVIDENDS_EXCEED_CONTRIBUTION", "Dividendos superiores ao aporte mensal", first(rows, (r) => toDecimal(r.dividendsReceived).gt(regular)));
  } else {
    out.push({ key: "DIVIDENDS_EXCEED_CONTRIBUTION", label: "Dividendos superiores ao aporte mensal", month: null, note: "Não se aplica: sem aporte mensal." });
  }
  for (const t of INCOME_THRESHOLDS) {
    add(`INCOME_${t}`, `R$ ${Number(t).toLocaleString("pt-BR")} de renda mensal`, first(rows, (r) => toDecimal(r.monthlyIncome).gte(t)));
  }
  for (const g of config.goals) {
    const target = toDecimal(g.target);
    const metric = (r: MonthResult) =>
      g.metric === "MONTHLY_INCOME" ? r.monthlyIncome
        : g.metric === "TOTAL_SHARES" ? r.endShares
          : g.metric === "PATRIMONY" ? r.patrimony
            : r.cumulativeDividends;
    add(`GOAL_${g.id}`, g.label, first(rows, (r) => toDecimal(metric(r)).gte(target)));
  }
  return out;
}
