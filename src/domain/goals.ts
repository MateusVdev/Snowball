import { FinDecimal, toDecimal, type DecimalInput } from "@/domain/money";
import type { MonthResult } from "@/domain/simulation";

/**
 * Metas financeiras (puras).
 * - Progresso = valor atual ÷ meta, limitado a 100%.
 * - Restante = max(meta − atual, 0).
 * - Estimativa de tempo: primeiro mês em que a simulação escolhida (premissas
 *   do usuário) atinge a meta. É hipotética; sem simulação, não há estimativa.
 */
export type GoalMetric = "MONTHLY_INCOME" | "PATRIMONY" | "TOTAL_SHARES" | "CUSTOM";

export function goalProgress(current: DecimalInput, target: DecimalInput) {
  const c = toDecimal(current);
  const t = toDecimal(target);
  const remaining = FinDecimal.max(t.minus(c), 0);
  const fraction = t.gt(0) ? FinDecimal.min(FinDecimal.max(c.dividedBy(t), 0), 1) : new FinDecimal(0);
  return { current: c, target: t, remaining, fraction, reached: c.gte(t) };
}

export function simulationMetricOf(metric: GoalMetric, row: MonthResult): string | null {
  if (metric === "MONTHLY_INCOME") return row.monthlyIncome;
  if (metric === "PATRIMONY") return row.patrimony;
  if (metric === "TOTAL_SHARES") return row.endShares;
  return null;
}

/** Primeiro mês da simulação em que a métrica alcança a meta (null = não alcança no prazo). */
export function estimateMonthsToGoal(metric: GoalMetric, target: DecimalInput, rows: readonly MonthResult[]): number | null {
  if (metric === "CUSTOM") return null;
  const t = toDecimal(target);
  const hit = rows.find((r) => {
    const v = simulationMetricOf(metric, r);
    return v !== null && toDecimal(v).gte(t);
  });
  return hit?.month ?? null;
}
