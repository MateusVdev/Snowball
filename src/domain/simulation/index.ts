export * from "./types";
export { simulate, monthLabel, SimulationConfigError } from "./engine";
export { priceAt, dividendPerShareAt, splitByWeights, valueAt } from "./assumptions";
export { computeMilestones, INCOME_THRESHOLDS } from "./milestones";
export { applyScenario, simulateScenarios, strategyVariants, DEFAULT_SCENARIOS, type ScenarioResult, type StrategyVariant } from "./scenarios";
export { defaultConfig, defaultFund, example96Config } from "./defaults";
