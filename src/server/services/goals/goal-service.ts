import { z } from "zod";
import type { Database } from "@/server/db/factory";
import { parseDecimalInput, toDecimal, type FinDecimal } from "@/domain/money";
import { estimateMonthsToGoal, goalProgress, type GoalMetric } from "@/domain/goals";
import { monthLabel } from "@/domain/simulation";
import { ServiceError } from "../errors";
import type { Overview } from "../overview/overview-service";
import { getSimulation } from "../simulation/simulation-service";
import { buildPatrimonyProjection } from "../patrimony/patrimony-projection-service";
import { monthsToReachTotal } from "@/domain/portfolio/patrimony-projection";

/**
 * Metas financeiras. Valor atual vem do banco (carteira e proventos) — exceto
 * metas personalizadas, cujo valor atual é informado pelo usuário. A
 * estimativa de prazo usa uma simulação escolhida (premissas hipotéticas).
 */

const money = (label: string) =>
  z.string().transform((raw, ctx) => {
    const v = parseDecimalInput(raw);
    if (v === null || toDecimal(v).lte(0) || toDecimal(v).decimalPlaces() > 2) {
      ctx.addIssue({ code: "custom", message: `${label}: informe um valor maior que zero (até 2 casas).` });
      return z.NEVER;
    }
    return v;
  });

export const goalSchema = z
  .object({
    name: z.string().trim().min(1, "Dê um nome à meta.").max(80),
    metric: z.enum(["MONTHLY_INCOME", "PATRIMONY", "TOTAL_SHARES", "CUSTOM", "TOTAL_PATRIMONY"], { error: "Escolha o tipo da meta." }),
    target: money("Meta"),
    customCurrent: z.string().optional(),
    simulationId: z.string().optional().transform((v) => (v ? v : null)),
    /** Só para "Patrimônio total": simulação de renda fixa usada na estimativa. */
    fixedIncomeSimulationId: z.string().optional().transform((v) => (v ? v : null)),
  })
  .transform((g, ctx) => {
    let customCurrent: string | null = null;
    if (g.metric === "CUSTOM") {
      const v = parseDecimalInput(g.customCurrent ?? "0") ?? "";
      if (v === "" || toDecimal(v).isNegative()) {
        ctx.addIssue({ code: "custom", path: ["customCurrent"], message: "Valor atual inválido." });
        return z.NEVER;
      }
      customCurrent = v;
    }
    if (g.metric === "TOTAL_SHARES" && !toDecimal(g.target).isInteger()) {
      ctx.addIssue({ code: "custom", path: ["target"], message: "Meta de cotas deve ser inteira." });
      return z.NEVER;
    }
    return { ...g, customCurrent, fixedIncomeSimulationId: g.metric === "TOTAL_PATRIMONY" ? g.fixedIncomeSimulationId : null };
  });
export type GoalInput = z.input<typeof goalSchema>;

async function checkSimulation(db: Database, userId: string, simulationId: string | null, fixedIncomeSimulationId: string | null = null) {
  if (simulationId) {
    const sim = await db.simulation.findFirst({ where: { id: simulationId, userId }, select: { id: true } });
    if (!sim) throw new ServiceError("INVALID", "Simulação não encontrada.");
  }
  if (fixedIncomeSimulationId) {
    const sim = await db.fixedIncomeSimulation.findFirst({ where: { id: fixedIncomeSimulationId, userId }, select: { id: true } });
    if (!sim) throw new ServiceError("INVALID", "Simulação de renda fixa não encontrada.");
  }
}

export async function createGoal(db: Database, userId: string, input: GoalInput) {
  const g = goalSchema.parse(input);
  await checkSimulation(db, userId, g.simulationId, g.fixedIncomeSimulationId);
  return db.financialGoal.create({ data: { userId, ...g } });
}

export async function updateGoal(db: Database, userId: string, id: string, input: GoalInput) {
  const g = goalSchema.parse(input);
  const existing = await db.financialGoal.findFirst({ where: { id, userId } });
  if (!existing) throw new ServiceError("NOT_FOUND", "Meta não encontrada.");
  await checkSimulation(db, userId, g.simulationId, g.fixedIncomeSimulationId);
  return db.financialGoal.update({ where: { id }, data: g });
}

export async function deleteGoal(db: Database, userId: string, id: string) {
  const existing = await db.financialGoal.findFirst({ where: { id, userId } });
  if (!existing) throw new ServiceError("NOT_FOUND", "Meta não encontrada.");
  await db.financialGoal.delete({ where: { id } });
}

export interface GoalStatus {
  id: string;
  name: string;
  metric: GoalMetric;
  target: FinDecimal;
  current: FinDecimal | null;
  currentNote: string;
  remaining: FinDecimal | null;
  fraction: FinDecimal | null;
  reached: boolean;
  simulation: { id: string; name: string } | null;
  fixedIncomeSimulation: { id: string; name: string } | null;
  /** Estimativa hipotética pela simulação vinculada. */
  estimate: { months: number | null; label: string | null; note: string } | null;
  customCurrent: string | null;
}

export async function listGoalStatuses(db: Database, userId: string, overview: Overview): Promise<GoalStatus[]> {
  const goals = await db.financialGoal.findMany({
    where: { userId },
    include: { simulation: { select: { id: true, name: true } }, fixedIncomeSimulation: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const marketValueKnown = overview.portfolio.totals.positionsWithoutQuote === 0;
  const simCache = new Map<string, Awaited<ReturnType<typeof getSimulation>>>();

  const out: GoalStatus[] = [];
  for (const g of goals) {
    const metric = g.metric as GoalMetric;
    let current: FinDecimal | null;
    let note: string;
    if (metric === "MONTHLY_INCOME") {
      current = overview.recurringIncome.total;
      note = "Renda mensal recorrente estimada: cotas atuais × último rendimento oficial pago (não é garantia).";
    } else if (metric === "PATRIMONY") {
      current = marketValueKnown ? overview.portfolio.totals.currentValue : null;
      note = marketValueKnown ? "Valor de mercado atual da carteira de FIIs (não inclui renda fixa)." : "Há fundos sem cotação: patrimônio indisponível.";
    } else if (metric === "TOTAL_PATRIMONY") {
      current = overview.patrimony.total;
      note = current
        ? "Patrimônio total: FIIs (valor de mercado) + renda fixa (valor bruto estimado)."
        : "Há fundos sem cotação: patrimônio total indisponível.";
    } else if (metric === "TOTAL_SHARES") {
      current = overview.totalShares;
      note = "Total de cotas em carteira.";
    } else {
      current = g.customCurrent ? toDecimal(g.customCurrent.toString()) : toDecimal(0);
      note = "Valor atual informado por você.";
    }
    const p = current ? goalProgress(current, g.target.toString()) : null;

    let estimate: GoalStatus["estimate"] = null;
    if (metric === "TOTAL_PATRIMONY" && (g.simulation || g.fixedIncomeSimulation)) {
      estimate = await totalPatrimonyEstimate(db, userId, g.target.toString(), g.simulation, g.fixedIncomeSimulation);
    } else if (g.simulation) {
      if (!simCache.has(g.simulation.id)) simCache.set(g.simulation.id, await getSimulation(db, userId, g.simulation.id));
      const sim = simCache.get(g.simulation.id);
      if (sim) {
        const months = estimateMonthsToGoal(metric, g.target.toString(), sim.result.months);
        estimate = {
          months,
          label: months ? monthLabel(sim.config.startMonth, months) : null,
          note:
            metric === "CUSTOM"
              ? "Metas personalizadas não são estimadas pelo simulador."
              : months
                ? `Pelas premissas de “${sim.name}” (hipotético; a simulação parte dos próprios valores iniciais).`
                : `Não alcançada em ${sim.config.months} meses pelas premissas de “${sim.name}”.`,
        };
      }
    }
    out.push({
      id: g.id,
      name: g.name,
      metric,
      target: toDecimal(g.target.toString()),
      current,
      currentNote: note,
      remaining: p?.remaining ?? null,
      fraction: p?.fraction ?? null,
      reached: p?.reached ?? false,
      simulation: g.simulation,
      fixedIncomeSimulation: g.fixedIncomeSimulation,
      estimate,
      customCurrent: g.customCurrent?.toString() ?? null,
    });
  }
  return out;
}

/**
 * Estimativa da meta de patrimônio total: primeiro mês em que FIIs (simulação
 * bola de neve) + renda fixa (simulação de renda fixa, valor bruto) alcançam a
 * meta. Se só uma simulação estiver vinculada, só ela é considerada (a nota diz isso).
 */
async function totalPatrimonyEstimate(
  db: Database,
  userId: string,
  target: string,
  fii: { id: string; name: string } | null,
  fixedIncome: { id: string; name: string } | null,
): Promise<GoalStatus["estimate"]> {
  try {
    const view = await buildPatrimonyProjection(db, userId, { fiiSimulationId: fii?.id, fixedIncomeSimulationId: fixedIncome?.id });
    const months = monthsToReachTotal(target, view.projection);
    const names = [fii?.name, fixedIncome?.name].filter(Boolean).map((n) => `“${n}”`).join(" + ");
    const partial = fii && fixedIncome ? "" : fii ? " Só FIIs simulados: vincule também uma simulação de renda fixa." : " Só renda fixa simulada: vincule também uma simulação de FIIs.";
    return {
      months,
      label: months ? monthLabel(view.fii?.startMonth ?? null, months) : null,
      note: (months
        ? `Pela soma de ${names} (hipotético).`
        : `Não alcançada em ${view.projection.months.length} meses pela soma de ${names}.`) + partial,
    };
  } catch {
    return { months: null, label: null, note: "Não foi possível estimar com as simulações vinculadas." };
  }
}
