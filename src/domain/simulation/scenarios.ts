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
