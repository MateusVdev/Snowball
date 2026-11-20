import { simulate } from "./engine";
import type { ScenarioConfig, SimulationConfig, SimulationResult } from "./types";

/**
 * Cenários HIPOTÉTICOS. Cada cenário substitui as regras de variação de todos
 * os fundos por taxas ANUAIS (preço e dividendo). O cenário de referência
 * mantém preços e dividendos constantes. Os valores padrão abaixo são
 * ilustrativos e editáveis — não são projeções nem promessas.
 */
export const DEFAULT_SCENARIOS: ScenarioConfig[] = [
  { key: "REFERENCE", label: "Referência (constante)", priceAnnualPercent: "0", dividendAnnualPercent: "0" },
  { key: "CONSERVATIVE", label: "Conservador", priceAnnualPercent: "0", dividendAnnualPercent: "-2" },
  { key: "MODERATE", label: "Moderado", priceAnnualPercent: "2", dividendAnnualPercent: "2" },
  { key: "OPTIMISTIC", label: "Otimista", priceAnnualPercent: "4", dividendAnnualPercent: "4" },
];

export function applyScenario(config: SimulationConfig, scenario: ScenarioConfig): SimulationConfig {
  const rule = (rate: string) =>
    scenario.key === "REFERENCE" || Number(rate) === 0
      ? ({ mode: "CONSTANT", ratePercent: "0" } as const)
      : ({ mode: "ANNUAL", ratePercent: rate } as const);
  return {
    ...config,
    funds: config.funds.map((f) => ({
      ...f,
      priceGrowth: rule(scenario.priceAnnualPercent),
      dividendGrowth: rule(scenario.dividendAnnualPercent),
      // Alterações manuais pontuais são premissas do usuário: mantidas.
    })),
  };
}

export interface ScenarioResult {
  scenario: ScenarioConfig;
  result: SimulationResult;
}

export function simulateScenarios(config: SimulationConfig): ScenarioResult[] {
  const scenarios = config.scenarios.length ? config.scenarios : DEFAULT_SCENARIOS;
  return scenarios.map((scenario) => ({ scenario, result: simulate(applyScenario(config, scenario)) }));
}

export interface StrategyVariant {
  key: "CONFIGURED" | "REINVEST_ALL" | "REINVEST_NONE" | "HIGHEST_YIELD";
  label: string;
  description: string;
  config: SimulationConfig;
}

/**
 * Estratégias comparáveis com as MESMAS premissas de preço, dividendo, aportes
 * e prazo — muda apenas o reinvestimento ou a distribuição dos recursos.
 */
export function strategyVariants(config: SimulationConfig): StrategyVariant[] {
  const withRate = (pct: "100" | "0") => ({ ...config, funds: config.funds.map((f) => ({ ...f, reinvestmentPercent: pct })) });
  const variants: StrategyVariant[] = [
    { key: "CONFIGURED", label: "Estratégia configurada", description: "Exatamente como definido.", config },
    { key: "REINVEST_ALL", label: "Reinvestir 100%", description: "Todos os fundos reinvestem todos os dividendos.", config: withRate("100") },
    { key: "REINVEST_NONE", label: "Sem reinvestir (0%)", description: "Dividendos retirados: mostra o efeito bola de neve por contraste.", config: withRate("0") },
  ];
  if (config.funds.length > 1 && config.allocation.mode !== "MANUAL") {
    // Maior dividendo/preço no mês 1 (premissa do usuário); empate: ordem dos fundos.
    const best = [...config.funds].sort((a, b) => {
      const ya = Number(a.monthlyDividend) / Number(a.price);
      const yb = Number(b.monthlyDividend) / Number(b.price);
      return yb - ya;
    })[0];
    variants.push({
      key: "HIGHEST_YIELD",
      label: `Concentrar em ${best.ticker}`,
      description: `Todo reinvestimento e aporte no fundo de maior dividendo/preço inicial (${best.ticker}).`,
      config: { ...config, allocation: { mode: "WEIGHTS", weights: Object.fromEntries(config.funds.map((f) => [f.key, f.key === best.key ? "100" : "0"])) } },
    });
  }
  return variants;
}
