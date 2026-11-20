import { DEFAULT_SCENARIOS } from "./scenarios";
import { ENGINE_VERSION, type SimFundConfig, type SimulationConfig } from "./types";

/** Fundo com premissas neutras (sem crescimento presumido). */
export function defaultFund(partial: Partial<SimFundConfig> & Pick<SimFundConfig, "key" | "ticker">): SimFundConfig {
  return {
    initialQuantity: "0",
    price: "10.00",
    monthlyDividend: "0.10",
    priceGrowth: { mode: "CONSTANT", ratePercent: "0" },
    dividendGrowth: { mode: "CONSTANT", ratePercent: "0" },
    priceChanges: [],
    dividendChanges: [],
    reinvestmentPercent: "100",
    calendar: { dataComDay: 28, paymentDay: 15, paymentLagMonths: 1 },
    ...partial,
  };
}

export function defaultConfig(partial: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    engineVersion: ENGINE_VERSION,
    months: 12,
    startMonth: null,
    timing: "MONTHLY",
    purchaseDay: 20,
    initialSharesEligibleBeforeStart: true,
    initialCash: "0",
    monthlyContribution: "0",
    extraContributions: [],
    allocation: { mode: "SAME_FUND", contributionWeights: {} },
    funds: [],
    goals: [],
    scenarios: DEFAULT_SCENARIOS,
    ...partial,
  };
}

/** Exemplo de referência validado manualmente: 96 cotas a R$ 10,00, R$ 0,10/mês, 100% reinvestido. */
export function example96Config(months = 12): SimulationConfig {
  return defaultConfig({
    months,
    funds: [defaultFund({ key: "F1", ticker: "EXEMPLO", initialQuantity: "96", price: "10.00", monthlyDividend: "0.10" })],
  });
}
