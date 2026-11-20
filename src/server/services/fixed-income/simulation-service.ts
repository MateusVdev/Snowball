import type { Database } from "@/server/db/factory";
import type { Prisma } from "@/generated/prisma/client";
import { todayIsoDate } from "@/domain/dates";
import { addDays, type IsoDate } from "@/domain/fixed-income/calendar";
import { dailyToAnnualPercent, simulateFixedIncome, type SimulationResult } from "@/domain/fixed-income/simulation";
import { roundMoney, roundTo } from "@/domain/money";
import type { IndexRateProvider } from "@/server/integrations/types";
import {
  fixedIncomeSimulationSchema,
  simulationNameSchema,
  type FixedIncomeSimulationConfig,
  type FixedIncomeSimulationFormInput,
} from "@/validation/fixed-income-simulation";
import { recordAudit } from "../audit";
import { ServiceError } from "../errors";
import { listFixedIncomeAssets } from "./fixed-income-service";
import { lastRateBefore, syncIndexRates } from "./index-rate-service";

/**
 * Simulador de renda fixa: valores pré-preenchidos (saldo atual e CDI atual),
 * cálculo e simulações salvas (tabela fixed_income_simulations). Todas as
 * funções de leitura/escrita filtram pelo userId.
 */

export interface CurrentCdi {
  /** CDI anual equivalente à última taxa diária publicada (% a.a., 2 casas). */
  annualPercent: string;
  dailyPercent: string;
  date: IsoDate;
}

/** CDI atual a partir do cache; se vazio, tenta buscar os últimos dias (limitado no tempo). */
export async function currentCdi(
  db: Database,
  provider: IndexRateProvider | null,
  opts: { today?: IsoDate; budgetMs?: number } = {},
): Promise<CurrentCdi | null> {
  const today = opts.today ?? todayIsoDate();
  let last = await lastRateBefore(db, "CDI", addDays(today, 1));
  if (!last && provider) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      syncIndexRates(db, provider, "CDI", { from: addDays(today, -20), to: today }).catch(() => null),
      new Promise((resolve) => {
        timer = setTimeout(resolve, opts.budgetMs ?? 5000);
      }),
    ]);
    clearTimeout(timer);
    last = await lastRateBefore(db, "CDI", addDays(today, 1));
  }
  if (!last) return null;
  return {
    annualPercent: roundTo(dailyToAnnualPercent(last.dailyRatePercent), 2).toFixed(2),
    dailyPercent: last.dailyRatePercent,
    date: last.date,
  };
}

export interface SimulatorDefaults {
  initialAmount: string;
  cdi: CurrentCdi | null;
}

export async function simulatorDefaults(db: Database, userId: string, provider: IndexRateProvider | null): Promise<SimulatorDefaults> {
  const [{ totals }, cdi] = await Promise.all([listFixedIncomeAssets(db, userId), currentCdi(db, provider)]);
  return { initialAmount: roundMoney(totals.gross).toFixed(2), cdi };
}

/** Valida os parâmetros e calcula (lança ZodError/ServiceError com mensagens amigáveis). */
export function runFixedIncomeSimulation(input: FixedIncomeSimulationFormInput): { config: FixedIncomeSimulationConfig; result: SimulationResult } {
  const config = fixedIncomeSimulationSchema.parse(input);
  return { config, result: simulateFixedIncome(config) };
}

export function simulationSummaryJson(result: SimulationResult): Prisma.InputJsonValue {
  const s = result.summary;
  const m = (v: { toFixed(n: number): string }) => v.toFixed(2);
  return { months: s.months, totalApplied: m(s.totalApplied), gross: m(s.gross), incomeTax: m(s.incomeTax), iof: m(s.iof), net: m(s.net), netEarnings: m(s.netEarnings) };
}

export async function saveFixedIncomeSimulation(
  db: Database,
  userId: string,
  input: { name: string; params: FixedIncomeSimulationFormInput; id?: string | null },
) {
  const name = simulationNameSchema.parse(input.name);
  const { config, result } = runFixedIncomeSimulation(input.params);
  const data = { name, config: config as unknown as Prisma.InputJsonValue, summary: simulationSummaryJson(result) };
  return db.$transaction(async (tx) => {
    let id: string;
    if (input.id) {
      const existing = await tx.fixedIncomeSimulation.findFirst({ where: { id: input.id, userId } });
      if (!existing) throw new ServiceError("NOT_FOUND", "Simulação não encontrada.");
      id = (await tx.fixedIncomeSimulation.update({ where: { id: input.id }, data })).id;
    } else {
      id = (await tx.fixedIncomeSimulation.create({ data: { userId, ...data } })).id;
    }
    await recordAudit(tx, {
      userId,
      entityType: "fixed_income_simulation",
      entityId: id,
      action: input.id ? "update" : "create",
      data: { name, config: data.config },
    });
    return id;
  });
}

export async function listFixedIncomeSimulations(db: Database, userId: string) {
  return db.fixedIncomeSimulation.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
}

export async function getFixedIncomeSimulation(db: Database, userId: string, id: string) {
  const sim = await db.fixedIncomeSimulation.findFirst({ where: { id, userId } });
  if (!sim) throw new ServiceError("NOT_FOUND", "Simulação não encontrada.");
  const parsed = fixedIncomeSimulationSchema.safeParse(sim.config);
  if (!parsed.success) throw new ServiceError("INVALID", "Simulação salva em formato inválido.");
  return { simulation: sim, config: parsed.data, result: simulateFixedIncome(parsed.data) };
}

export async function deleteFixedIncomeSimulation(db: Database, userId: string, id: string) {
  return db.$transaction(async (tx) => {
    const sim = await tx.fixedIncomeSimulation.findFirst({ where: { id, userId } });
    if (!sim) throw new ServiceError("NOT_FOUND", "Simulação não encontrada.");
    await tx.fixedIncomeSimulation.delete({ where: { id } });
    await recordAudit(tx, { userId, entityType: "fixed_income_simulation", entityId: id, action: "delete", data: { name: sim.name } });
  });
}
