import { toDecimal, type DecimalInput, type FinDecimal } from "@/domain/money";
import { ASSET_CLASSES, patrimonyByClass, type AssetClassKey, type AssetClassSlice } from "./asset-classes";

/**
 * Simulação do patrimônio total: junta, mês a mês, as séries simuladas de cada
 * classe de ativo (FIIs pelo simulador bola de neve, renda fixa pelo simulador
 * de renda fixa; Ações no futuro — basta fornecer a série).
 *
 * - Todas as séries contam a partir do mês 1 (mesmo ponto de partida).
 * - O resultado vai até o prazo da série MAIS CURTA: depois disso não haveria
 *   valor simulado para alguma classe, e nada é inventado.
 * - Total e divisão de cada mês usam `patrimonyByClass` (mesma regra do dashboard).
 */

export interface ClassSeries {
  key: AssetClassKey;
  /** Nome da simulação de origem (para exibição). */
  source: string;
  /** Valor da classe no fim de cada mês (índice 0 = mês 1). */
  values: readonly DecimalInput[];
}

export interface PatrimonyProjectionMonth {
  month: number;
  total: FinDecimal;
  classes: AssetClassSlice[];
  /** Valor por classe (0 quando a classe não tem valor no mês). */
  byClass: Partial<Record<AssetClassKey, FinDecimal>>;
}

export interface PatrimonyProjection {
  months: PatrimonyProjectionMonth[];
  /** Classes incluídas, na ordem de ASSET_CLASSES. */
  classes: { key: AssetClassKey; label: string; source: string; months: number }[];
  /** true quando alguma série foi cortada pelo prazo da mais curta. */
  truncated: boolean;
}

export function projectPatrimony(series: readonly ClassSeries[]): PatrimonyProjection {
  const present = series.filter((s) => s.values.length > 0);
  const keys = new Set(present.map((s) => s.key));
  if (keys.size !== present.length) throw new RangeError("Cada classe de ativo só pode aparecer uma vez.");
  if (present.length === 0) return { months: [], classes: [], truncated: false };
  const length = Math.min(...present.map((s) => s.values.length));
  const months: PatrimonyProjectionMonth[] = [];
  for (let i = 0; i < length; i++) {
    const p = patrimonyByClass(present.map((s) => ({ key: s.key, value: s.values[i] })));
    months.push({
      month: i + 1,
      total: p.total ?? p.knownTotal,
      classes: p.classes,
      byClass: Object.fromEntries(present.map((s) => [s.key, toDecimal(s.values[i])])),
    });
  }
  const order = ASSET_CLASSES.map((c) => c.key as AssetClassKey);
  return {
    months,
    classes: [...present]
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
      .map((s) => ({ key: s.key, label: ASSET_CLASSES.find((c) => c.key === s.key)!.label, source: s.source, months: s.values.length })),
    truncated: present.some((s) => s.values.length > length),
  };
}

/** Primeiro mês em que o patrimônio total simulado alcança a meta (null = não alcança no prazo). */
export function monthsToReachTotal(target: DecimalInput, projection: PatrimonyProjection): number | null {
  const t = toDecimal(target);
  return projection.months.find((m) => m.total.gte(t))?.month ?? null;
}
