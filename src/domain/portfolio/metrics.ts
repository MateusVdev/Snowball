import { FinDecimal, toDecimal, type DecimalInput } from "@/domain/money";

/**
 * Indicadores de uma posição a partir do estado do livro-razão e da cotação.
 * Resultados em precisão total — arredondar apenas para exibir/persistir.
 *
 * - Preço médio        = custo total / quantidade
 * - Capital investido  = custo total das cotas em carteira (inclui taxas de compra)
 * - Valor atual        = quantidade × cotação atual
 * - Resultado não realizado = valor atual − capital investido
 * - Rentabilidade      = resultado não realizado / capital investido
 * - Resultado total    = realizado + não realizado
 *
 * Sem cotação, os campos dependentes dela ficam null ("indisponível") — nunca
 * se usa uma estimativa no lugar.
 */
export interface PositionMetricsInput {
  quantity: DecimalInput;
  totalCost: DecimalInput;
  realizedResult: DecimalInput;
  currentPrice: DecimalInput | null;
}

export interface PositionMetrics {
  quantity: FinDecimal;
  averagePrice: FinDecimal | null;
  investedCapital: FinDecimal;
  currentPrice: FinDecimal | null;
  currentValue: FinDecimal | null;
  unrealizedResult: FinDecimal | null;
  /** Fração (0.01 = 1%). */
  unrealizedReturn: FinDecimal | null;
  realizedResult: FinDecimal;
  totalResult: FinDecimal | null;
}

export function computePositionMetrics(
  input: PositionMetricsInput,
): PositionMetrics {
  const quantity = toDecimal(input.quantity);
  const investedCapital = toDecimal(input.totalCost);
  const realizedResult = toDecimal(input.realizedResult);
  const currentPrice =
    input.currentPrice === null ? null : toDecimal(input.currentPrice);

  const averagePrice = quantity.isZero()
    ? null
    : investedCapital.dividedBy(quantity);
  const currentValue = currentPrice ? quantity.times(currentPrice) : null;
  const unrealizedResult = currentValue
    ? currentValue.minus(investedCapital)
    : null;
  const unrealizedReturn =
    unrealizedResult && investedCapital.gt(0)
      ? unrealizedResult.dividedBy(investedCapital)
      : null;

  return {
    quantity,
    averagePrice,
    investedCapital,
    currentPrice,
    currentValue,
    unrealizedResult,
    unrealizedReturn,
    realizedResult,
    totalResult: unrealizedResult ? unrealizedResult.plus(realizedResult) : null,
  };
}

export interface PortfolioTotals {
  investedCapital: FinDecimal;
  /** Soma apenas das posições com cotação. */
  currentValue: FinDecimal;
  unrealizedResult: FinDecimal;
  unrealizedReturn: FinDecimal | null;
  realizedResult: FinDecimal;
  /** Posições abertas sem cotação (totais de mercado ficam incompletos). */
  positionsWithoutQuote: number;
}

/** Consolida a carteira. Rentabilidade considera só posições com cotação. */
export function computePortfolioTotals(
  positions: readonly PositionMetrics[],
): PortfolioTotals {
  const zero = new FinDecimal(0);
  let invested = zero;
  let investedWithQuote = zero;
  let value = zero;
  let unrealized = zero;
  let realized = zero;
  let withoutQuote = 0;

  for (const p of positions) {
    invested = invested.plus(p.investedCapital);
    realized = realized.plus(p.realizedResult);
    if (p.quantity.isZero()) continue;
    if (p.currentValue && p.unrealizedResult) {
      investedWithQuote = investedWithQuote.plus(p.investedCapital);
      value = value.plus(p.currentValue);
      unrealized = unrealized.plus(p.unrealizedResult);
    } else {
      withoutQuote += 1;
    }
  }

  return {
    investedCapital: invested,
    currentValue: value,
    unrealizedResult: unrealized,
    unrealizedReturn: investedWithQuote.gt(0)
      ? unrealized.dividedBy(investedWithQuote)
      : null,
    realizedResult: realized,
    positionsWithoutQuote: withoutQuote,
  };
}
