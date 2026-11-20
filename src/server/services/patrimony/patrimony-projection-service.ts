import type { Database } from "@/server/db/factory";
import type { FinDecimal } from "@/domain/money";
import { projectPatrimony, type ClassSeries, type PatrimonyProjection } from "@/domain/portfolio/patrimony-projection";
import { ServiceError } from "../errors";
import { getFixedIncomeSimulation } from "../fixed-income/simulation-service";
import { getSimulation } from "../simulation/simulation-service";

/**
 * Simulação do patrimônio total a partir de simulações SALVAS do usuário:
 * FIIs (simulador bola de neve → patrimônio de cada mês) + renda fixa
 * (simulador de renda fixa → valor BRUTO de cada mês, a mesma base do
 * patrimônio do dashboard; o líquido é informado à parte).
 * Ações: quando existir um simulador, basta acrescentar a série "STOCKS".
 */

export interface PatrimonyProjectionView {
  projection: PatrimonyProjection;
  fii: { id: string; name: string; startMonth: string | null } | null;
  fixedIncome: { id: string; name: string; startDate: string } | null;
  /** Total líquido de IR da renda fixa (FIIs + renda fixa líquida), por mês. */
  netTotals: FinDecimal[];
}

export async function buildPatrimonyProjection(
  db: Database,
  userId: string,
  ids: { fiiSimulationId?: string | null; fixedIncomeSimulationId?: string | null },
): Promise<PatrimonyProjectionView> {
  if (!ids.fiiSimulationId && !ids.fixedIncomeSimulationId) {
    throw new ServiceError("INVALID", "Escolha ao menos uma simulação (FIIs ou renda fixa).");
  }
  const series: ClassSeries[] = [];
  let fii: PatrimonyProjectionView["fii"] = null;
  let fixedIncome: PatrimonyProjectionView["fixedIncome"] = null;
  let fiiValues: string[] = [];
  let rfNet: FinDecimal[] = [];

  if (ids.fiiSimulationId) {
    const sim = await getSimulation(db, userId, ids.fiiSimulationId);
    if (!sim) throw new ServiceError("NOT_FOUND", "Simulação de FIIs não encontrada.");
    fii = { id: sim.id, name: sim.name, startMonth: sim.config.startMonth ?? null };
    fiiValues = sim.result.months.map((m) => m.patrimony);
    series.push({ key: "FII", source: sim.name, values: fiiValues });
  }
  if (ids.fixedIncomeSimulationId) {
    const { simulation, config, result } = await getFixedIncomeSimulation(db, userId, ids.fixedIncomeSimulationId);
    fixedIncome = { id: simulation.id, name: simulation.name, startDate: config.startDate };
    rfNet = result.rows.map((r) => r.net);
    series.push({ key: "FIXED_INCOME", source: simulation.name, values: result.rows.map((r) => r.gross) });
  }
  const projection = projectPatrimony(series);
  const netTotals = projection.months.map((m, i) => {
    const f = m.byClass.FII ?? null;
    const rf = rfNet[i] ?? null;
    return (f ? f.plus(rf ?? 0) : rf!) as FinDecimal;
  });
  return { projection, fii, fixedIncome, netTotals };
}
