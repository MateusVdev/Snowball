import type { Database } from "@/server/db/factory";
import type { Prisma } from "@/generated/prisma/client";
import { todayIsoDate, toIsoDate } from "@/domain/dates";
import { roundMoney } from "@/domain/money";
import {
  defaultConfig,
  defaultFund,
  simulate,
  simulateScenarios,
  applyScenario,
  type ScenarioResult,
  type SimulationConfig,
  type SimulationResult,
} from "@/domain/simulation";
import { parseSimulationConfig, simulationMetaSchema } from "@/validation/simulation";
import { ServiceError } from "../errors";
import { listDividendEvents } from "../dividends/dividend-service";
import { getPortfolio } from "../portfolio/fund-service";

/**
 * Simulações salvas. ISOLAMENTO: este serviço só lê a carteira real (para
 * importar uma CÓPIA dos valores) e só grava nas tabelas simulations e
 * simulation_versions. Nenhuma função aqui altera fundos, operações,
 * posições, cotações ou proventos.
 */

export type SimulationOrigin = "MANUAL" | "PORTFOLIO";

function summaryJson(result: SimulationResult) {
  return {
    ...result.summary,
    milestonesReached: result.milestones.filter((m) => m.month !== null).length,
  } as unknown as Prisma.InputJsonValue;
}

export async function listSimulations(db: Database, userId: string) {
  return db.simulation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, description: true, origin: true, summary: true, engineVersion: true, createdAt: true, updatedAt: true, _count: { select: { versions: true } } },
  });
}

async function findOwned(db: Database | Prisma.TransactionClient, userId: string, id: string) {
  const sim = await db.simulation.findFirst({ where: { id, userId } });
  if (!sim) throw new ServiceError("NOT_FOUND", "Simulação não encontrada.");
  return sim;
}

export interface LoadedSimulation {
  id: string;
  name: string;
  description: string | null;
  origin: SimulationOrigin;
  config: SimulationConfig;
  result: SimulationResult;
  scenarios: ScenarioResult[];
  createdAt: Date;
  updatedAt: Date;
}

export async function getSimulation(db: Database, userId: string, id: string): Promise<LoadedSimulation | null> {
  const sim = await db.simulation.findFirst({ where: { id, userId } });
  if (!sim) return null;
  // Revalida a configuração salva e recalcula (determinístico).
  const config = parseSimulationConfig(sim.config);
  return {
    id: sim.id,
    name: sim.name,
    description: sim.description,
    origin: sim.origin as SimulationOrigin,
    config,
    result: simulate(config),
    scenarios: simulateScenarios(config),
    createdAt: sim.createdAt,
    updatedAt: sim.updatedAt,
  };
}

export async function createSimulation(
  db: Database,
  userId: string,
  meta: { name: string; description?: string | null },
  rawConfig: unknown,
  origin: SimulationOrigin = "MANUAL",
) {
  const m = simulationMetaSchema.parse(meta);
  const config = parseSimulationConfig(rawConfig);
  const result = simulate(config);
  return db.$transaction(async (tx) => {
    const sim = await tx.simulation.create({
      data: {
        userId,
        name: m.name,
        description: m.description,
        origin,
        config: config as unknown as Prisma.InputJsonValue,
        engineVersion: result.engineVersion,
        summary: summaryJson(result),
      },
    });
    await tx.simulationVersion.create({
      data: { simulationId: sim.id, version: 1, config: sim.config as Prisma.InputJsonValue, engineVersion: result.engineVersion, summary: summaryJson(result), note: "Criação" },
    });
    return sim;
  });
}

export async function updateSimulation(
  db: Database,
  userId: string,
  id: string,
  meta: { name: string; description?: string | null },
  rawConfig: unknown,
) {
  const m = simulationMetaSchema.parse(meta);
  const config = parseSimulationConfig(rawConfig);
  const result = simulate(config);
  return db.$transaction(async (tx) => {
    await findOwned(tx, userId, id);
    const last = await tx.simulationVersion.findFirst({ where: { simulationId: id }, orderBy: { version: "desc" }, select: { version: true } });
    const sim = await tx.simulation.update({
      where: { id },
      data: { name: m.name, description: m.description, config: config as unknown as Prisma.InputJsonValue, engineVersion: result.engineVersion, summary: summaryJson(result) },
    });
    await tx.simulationVersion.create({
      data: { simulationId: id, version: (last?.version ?? 0) + 1, config: sim.config as Prisma.InputJsonValue, engineVersion: result.engineVersion, summary: summaryJson(result), note: "Edição" },
    });
    return sim;
  });
}

export async function duplicateSimulation(db: Database, userId: string, id: string) {
  const sim = await findOwned(db, userId, id);
  return createSimulation(db, userId, { name: `${sim.name} (cópia)`.slice(0, 80), description: sim.description }, sim.config, sim.origin as SimulationOrigin);
}

/** Exclui a simulação e seu histórico de versões (não afeta a carteira real). */
export async function deleteSimulation(db: Database, userId: string, id: string) {
  await findOwned(db, userId, id);
  await db.simulation.delete({ where: { id } });
}

export async function listSimulationVersions(db: Database, userId: string, id: string) {
  await findOwned(db, userId, id);
  return db.simulationVersion.findMany({
    where: { simulationId: id },
    orderBy: { version: "desc" },
    select: { id: true, version: true, note: true, createdAt: true, summary: true, engineVersion: true },
  });
}

/** Restaura uma versão anterior criando uma NOVA versão (o histórico é preservado). */
export async function restoreSimulationVersion(db: Database, userId: string, id: string, versionId: string) {
  const sim = await findOwned(db, userId, id);
  const version = await db.simulationVersion.findFirst({ where: { id: versionId, simulationId: id } });
  if (!version) throw new ServiceError("NOT_FOUND", "Versão não encontrada.");
  return updateSimulation(db, userId, id, { name: sim.name, description: sim.description }, version.config);
}

export interface PortfolioImport {
  config: SimulationConfig;
  warnings: string[];
  snapshotDate: string;
}

/**
 * Monta uma configuração a partir da carteira real (CÓPIA dos valores do dia):
 * quantidade atual, cotação atual e último rendimento oficial pago por cota.
 * Sem cotação ou sem rendimento conhecido, avisa em vez de inventar.
 */
export async function buildConfigFromPortfolio(db: Database, userId: string, months = 120): Promise<PortfolioImport> {
  const todayIso = todayIsoDate();
  const { positions } = await getPortfolio(db, userId);
  const open = positions.filter((p) => p.metrics.quantity.gt(0));
  const warnings: string[] = [];
  if (open.length === 0) throw new ServiceError("INVALID", "A carteira real não tem posições abertas para importar.");

  const events = await listDividendEvents(db, userId, { todayIso });
  const funds = open.map((p, i) => {
    const lastPaid = events
      .filter((e) => e.fundId === p.fundId && e.kind === "OFFICIAL" && e.type === "INCOME" && e.status === "PAID" && e.paymentDate)
      .sort((a, b) => b.dataCom.getTime() - a.dataCom.getTime())[0];
    let price = p.metrics.currentPrice;
    if (!price) {
      price = p.metrics.averagePrice;
      warnings.push(`${p.ticker}: sem cotação registrada — usado o preço médio (R$ ${roundMoney(price!).toFixed(2)}). Revise.`);
    }
    if (!lastPaid) warnings.push(`${p.ticker}: nenhum rendimento oficial registrado — dividendo definido como 0. Informe a premissa.`);
    const qty = p.metrics.quantity;
    if (!qty.isInteger()) warnings.push(`${p.ticker}: quantidade fracionária arredondada para baixo.`);
    const calendar = lastPaid
      ? {
          dataComDay: Math.min(28, lastPaid.dataCom.getUTCDate()),
          paymentDay: Math.min(28, lastPaid.paymentDate!.getUTCDate()),
          paymentLagMonths: Math.max(
            0,
            Math.min(3, (lastPaid.paymentDate!.getUTCFullYear() - lastPaid.dataCom.getUTCFullYear()) * 12 + lastPaid.paymentDate!.getUTCMonth() - lastPaid.dataCom.getUTCMonth()),
          ),
        }
      : undefined;
    return defaultFund({
      key: `F${i + 1}`,
      ticker: p.ticker,
      initialQuantity: qty.floor().toFixed(),
      price: roundMoney(price!).toFixed(2),
      monthlyDividend: lastPaid ? lastPaid.ratePerShare : "0",
      ...(calendar ? { calendar } : {}),
    });
  });
  for (const p of open) {
    if (p.quote?.stale) warnings.push(`${p.ticker}: a cotação usada está desatualizada (${toIsoDate(p.quote.asOf)}).`);
  }
  const [y, m] = todayIso.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return {
    config: defaultConfig({ months, startMonth: next, funds }),
    warnings,
    snapshotDate: todayIso,
  };
}

/** Duplica um cenário hipotético como nova simulação (premissas do cenário gravadas na configuração). */
export async function createSimulationFromScenario(db: Database, userId: string, id: string, scenarioKey: string) {
  const sim = await findOwned(db, userId, id);
  const config = parseSimulationConfig(sim.config);
  const scenario = config.scenarios.find((s) => s.key === scenarioKey);
  if (!scenario) throw new ServiceError("NOT_FOUND", "Cenário não encontrado.");
  return createSimulation(
    db,
    userId,
    { name: `${sim.name} — ${scenario.label}`.slice(0, 80), description: `Criada a partir do cenário hipotético “${scenario.label}” (preço ${scenario.priceAnnualPercent}% a.a., dividendo ${scenario.dividendAnnualPercent}% a.a.).` },
    applyScenario(config, scenario),
    sim.origin as SimulationOrigin,
  );
}

export interface PortfolioFundOption {
  ticker: string;
  quantity: string;
  price: string;
  monthlyDividend: string;
  calendar: { dataComDay: number; paymentDay: number; paymentLagMonths: number } | null;
}

/** Fundos da carteira real para o seletor do editor (cópia de valores). */
export async function portfolioFundOptions(db: Database, userId: string): Promise<PortfolioFundOption[]> {
  try {
    const imp = await buildConfigFromPortfolio(db, userId, 12);
    return imp.config.funds.map((f) => ({ ticker: f.ticker, quantity: f.initialQuantity, price: f.price, monthlyDividend: f.monthlyDividend, calendar: f.calendar }));
  } catch {
    return [];
  }
}
