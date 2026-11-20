/**
 * Tipos do motor de simulação "Bola de Neve".
 *
 * Valores monetários e taxas trafegam como string decimal (nunca number) para
 * que a mesma configuração produza sempre o mesmo resultado (determinismo).
 * Quantidades de cotas são inteiras (FIIs são negociados em cotas inteiras).
 */

/** Versão do motor. Muda quando uma regra de cálculo muda. */
export const ENGINE_VERSION = "1.0.0";

export const MAX_MONTHS = 600; // 50 anos
export const MAX_FUNDS = 20;
export const REINVESTMENT_OPTIONS = ["100", "75", "50", "25", "0"] as const;
export type ReinvestmentPercent = (typeof REINVESTMENT_OPTIONS)[number];

/**
 * Regra de variação de um valor (preço ou dividendo por cota).
 * - CONSTANT: não varia.
 * - MONTHLY: composta a cada mês: valor × (1 + taxa)^(meses decorridos).
 * - ANNUAL: aplicada a cada 12 meses (meses 13, 25, …): valor × (1 + taxa)^(anos completos).
 * `ratePercent` é o percentual por período (pode ser negativo, > −100).
 */
export interface GrowthRule {
  mode: "CONSTANT" | "MONTHLY" | "ANNUAL";
  ratePercent: string;
}

/** Alteração manual: a partir de `month`, o valor-base passa a ser `value` (e a regra de variação recomeça). */
export interface ValueChange {
  month: number;
  value: string;
}

/** Calendário de um fundo (modelo CALENDAR). Dias de 1 a 28. */
export interface FundCalendar {
  /** Dia do mês da data-com. */
  dataComDay: number;
  /** Dia do mês do pagamento. */
  paymentDay: number;
  /** Meses entre a data-com e o pagamento (0 = mesmo mês; 1 = mês seguinte…). */
  paymentLagMonths: number;
}

export interface SimFundConfig {
  /** Identificador estável dentro da simulação. */
  key: string;
  ticker: string;
  initialQuantity: string;
  /** Preço inicial da cota (R$). */
  price: string;
  /** Dividendo mensal por cota no mês 1 (R$). */
  monthlyDividend: string;
  priceGrowth: GrowthRule;
  dividendGrowth: GrowthRule;
  priceChanges: ValueChange[];
  dividendChanges: ValueChange[];
  /** Percentual dos dividendos deste fundo que é reinvestido. */
  reinvestmentPercent: ReinvestmentPercent;
  calendar: FundCalendar;
}

export interface ExtraContribution {
  month: number;
  amount: string;
  /** Fundo de destino (opcional; sem destino, segue a estratégia). */
  fundKey: string | null;
}

/**
 * Estratégia de distribuição dos recursos:
 * - SAME_FUND: o dividendo reinvestido volta para o fundo que o gerou; os
 *   aportes são divididos por `contributionWeights` (%).
 * - WEIGHTS: dividendos reinvestidos e aportes são divididos por `weights`
 *   (%). Ex.: 100% em um fundo = "para um fundo específico".
 * - MANUAL: todo o dinheiro vai para um caixa comum e compra-se só o que o
 *   usuário planejou (`purchases`), se houver saldo.
 */
export type AllocationStrategy =
  | { mode: "SAME_FUND"; contributionWeights: Record<string, string> }
  | { mode: "WEIGHTS"; weights: Record<string, string> }
  | { mode: "MANUAL"; purchases: { month: number; fundKey: string; quantity: number }[] };

export type GoalMetric = "MONTHLY_INCOME" | "TOTAL_SHARES" | "PATRIMONY" | "TOTAL_DIVIDENDS";

export interface CustomGoal {
  id: string;
  label: string;
  metric: GoalMetric;
  target: string;
}

/** Cenário: substitui as regras de variação de TODOS os fundos por taxas anuais. */
export interface ScenarioConfig {
  key: "REFERENCE" | "CONSERVATIVE" | "MODERATE" | "OPTIMISTIC";
  label: string;
  priceAnnualPercent: string;
  dividendAnnualPercent: string;
}

export interface SimulationConfig {
  engineVersion: string;
  /** Prazo em meses. */
  months: number;
  /** Mês civil do mês 1 ("AAAA-MM"), apenas para rótulos. */
  startMonth: string | null;
  timing: "MONTHLY" | "CALENDAR";
  /** Dia das compras e dos aportes no modelo CALENDAR (1–28). */
  purchaseDay: number;
  /**
   * Modelo CALENDAR com pagamento em mês posterior à data-com: considerar
   * que as cotas iniciais já estavam na carteira nas datas-com anteriores ao
   * mês 1 (gerando os pagamentos dos primeiros meses).
   */
  initialSharesEligibleBeforeStart: boolean;
  initialCash: string;
  monthlyContribution: string;
  extraContributions: ExtraContribution[];
  allocation: AllocationStrategy;
  funds: SimFundConfig[];
  goals: CustomGoal[];
  scenarios: ScenarioConfig[];
}

// ---------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------

/** Valores monetários como string com 2 casas; quantidades como inteiros em string. */
export interface FundMonthResult {
  key: string;
  ticker: string;
  price: string;
  dividendPerShare: string;
  startShares: string;
  /** Cotas elegíveis: no início do mês (MONTHLY) ou na data-com (CALENDAR). */
  eligibleShares: string;
  /** Dividendos gerados no mês (data-com no mês). */
  dividendsGenerated: string;
  /** Dividendos efetivamente recebidos (pagos) no mês. */
  dividendsReceived: string;
  reinvested: string;
  notReinvested: string;
  contributions: string;
  /** Caixa do fundo disponível para compra (null na estratégia MANUAL, que usa caixa comum). */
  cashAvailable: string | null;
  sharesBought: string;
  sharesBoughtWithDividendsOnly: string;
  spent: string;
  endShares: string;
  cashRemaining: string | null;
  positionValue: string;
}

export interface MonthResult {
  month: number;
  label: string;
  startShares: string;
  eligibleShares: string;
  dividendsGenerated: string;
  dividendsReceived: string;
  reinvested: string;
  notReinvested: string;
  regularContribution: string;
  extraContribution: string;
  /** Caixa total disponível no momento da compra (saldo anterior + entradas). */
  cashAvailable: string;
  sharesBought: string;
  sharesBoughtWithDividendsOnly: string;
  spent: string;
  endShares: string;
  /** Saldo que sobra para os meses seguintes. */
  cashRemaining: string;
  /** Renda mensal = dividendos recebidos no mês. */
  monthlyIncome: string;
  /** Renda passiva futura = cotas finais × dividendo por cota do mês seguinte. */
  projectedNextMonthIncome: string;
  /** Patrimônio = Σ cotas × preço do mês + caixa (exclui o não reinvestido, que saiu). */
  patrimony: string;
  cumulativeDividends: string;
  cumulativeContributions: string;
  cumulativeNotReinvested: string;
  funds: FundMonthResult[];
}

export interface Milestone {
  key: string;
  label: string;
  month: number | null;
  /** Explicação quando não se aplica / não atingido. */
  note: string | null;
}

export interface SimulationSummary {
  months: number;
  initialShares: string;
  finalShares: string;
  sharesBought: string;
  /** Cotas integralmente pagas com dinheiro de dividendos (no prazo). */
  sharesBoughtWithDividendsOnly: string;
  totalDividendsReceived: string;
  /** Dividendos gerados com pagamento após o fim do prazo (modelo CALENDAR). */
  dividendsPendingAfterHorizon: string;
  totalReinvested: string;
  totalNotReinvested: string;
  totalContributions: string;
  initialCash: string;
  finalCash: string;
  initialPatrimony: string;
  finalPatrimony: string;
  finalMonthlyIncome: string;
  projectedNextMonthIncome: string;
}

export interface SimulationResult {
  engineVersion: string;
  hypothetical: true;
  months: MonthResult[];
  summary: SimulationSummary;
  milestones: Milestone[];
}
