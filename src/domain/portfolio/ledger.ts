import {
  FinDecimal,
  SCALE,
  roundMoney,
  toDecimal,
  type DecimalInput,
} from "@/domain/money";

/**
 * Livro-razão de um fundo: reprocessa as operações ATIVAS em ordem e calcula
 * quantidade, custo, preço médio e resultados realizados.
 *
 * Regras (ver DOCUMENTATION/FINANCIAL_RULES.md):
 * - Saldo inicial: custo = quantidade × preço médio informado (exato, sem taxas).
 * - Compra: custo += round2(qtd × preço) + taxas; preço médio é recalculado.
 * - Venda: custo das cotas vendidas = custo × qtd_vendida / qtd_atual
 *   (equivale ao preço médio ANTERIOR × qtd vendida, sem erro de arredondamento);
 *   o preço médio das cotas remanescentes NÃO muda;
 *   resultado realizado = (round2(qtd × preço) − taxas) − custo das cotas vendidas.
 * - Toda a conta é feita em Decimal com precisão total; arredonda-se só na
 *   persistência/apresentação.
 *
 * Módulo puro: sem banco, sem Next, sem React.
 */

export type LedgerOperationType = "INITIAL_BALANCE" | "BUY" | "SELL";

export interface LedgerOperationInput {
  id: string;
  type: LedgerOperationType;
  /** Nula apenas para INITIAL_BALANCE. */
  tradeDate: Date | null;
  sequence: number;
  quantity: DecimalInput;
  unitPrice: DecimalInput;
  fees: DecimalInput;
}

export interface LedgerStep {
  id: string;
  type: LedgerOperationType;
  quantity: FinDecimal;
  grossAmount: FinDecimal;
  netAmount: FinDecimal;
  quantityAfter: FinDecimal;
  totalCostAfter: FinDecimal;
  /** Preço médio após a operação (null se a posição zerou). */
  averagePriceAfter: FinDecimal | null;
  /** Apenas vendas. */
  costOfSold: FinDecimal | null;
  /** Apenas vendas. */
  realizedResult: FinDecimal | null;
}

export interface LedgerState {
  quantity: FinDecimal;
  /** Custo das cotas em carteira (inclui taxas de compra). */
  totalCost: FinDecimal;
  /** Soma dos resultados realizados. */
  realizedResult: FinDecimal;
}

export interface LedgerResult {
  steps: LedgerStep[];
  final: LedgerState;
}

export type LedgerErrorCode =
  | "INSUFFICIENT_QUANTITY"
  | "INITIAL_BALANCE_NOT_FIRST"
  | "DUPLICATE_INITIAL_BALANCE"
  | "MISSING_TRADE_DATE"
  | "INVALID_VALUE";

export class LedgerError extends Error {
  constructor(
    public readonly code: LedgerErrorCode,
    message: string,
    public readonly operationId?: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

const ZERO = new FinDecimal(0);

/** Valor bruto de compra/venda: quantidade × preço, arredondado a centavos. */
export function grossAmountOf(
  quantity: DecimalInput,
  unitPrice: DecimalInput,
): FinDecimal {
  return roundMoney(toDecimal(quantity).times(toDecimal(unitPrice)));
}

/**
 * Valores financeiros de uma operação isolada.
 * - INITIAL_BALANCE: bruto = líquido = qtd × preço médio (exibido em centavos).
 * - BUY: líquido = bruto + taxas (desembolso total).
 * - SELL: líquido = bruto − taxas (valor recebido).
 */
export function operationAmounts(
  type: LedgerOperationType,
  quantity: DecimalInput,
  unitPrice: DecimalInput,
  fees: DecimalInput,
): { grossAmount: FinDecimal; netAmount: FinDecimal } {
  const gross = grossAmountOf(quantity, unitPrice);
  const feesD = toDecimal(fees);
  if (type === "BUY") return { grossAmount: gross, netAmount: gross.plus(feesD) };
  if (type === "SELL") return { grossAmount: gross, netAmount: gross.minus(feesD) };
  return { grossAmount: gross, netAmount: gross };
}

/**
 * Ordem canônica: saldo inicial primeiro (representa a posição anterior a
 * qualquer operação registrada), depois data do pregão e ordem de registro.
 */
export function sortLedgerOperations<T extends LedgerOperationInput>(
  operations: readonly T[],
): T[] {
  return [...operations].sort((a, b) => {
    const aInitial = a.type === "INITIAL_BALANCE" ? 0 : 1;
    const bInitial = b.type === "INITIAL_BALANCE" ? 0 : 1;
    if (aInitial !== bInitial) return aInitial - bInitial;
    const aTime = a.tradeDate?.getTime() ?? 0;
    const bTime = b.tradeDate?.getTime() ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.sequence - b.sequence;
  });
}

function assertPositive(value: FinDecimal, label: string, id: string) {
  if (!value.isFinite() || value.lte(0)) {
    throw new LedgerError("INVALID_VALUE", `${label} deve ser maior que zero.`, id);
  }
}

/** Reprocessa as operações (em qualquer ordem de entrada) e valida o histórico. */
export function replayLedger(
  operations: readonly LedgerOperationInput[],
): LedgerResult {
  const ordered = sortLedgerOperations(operations);
  let quantity = ZERO;
  let totalCost = ZERO;
  let realized = ZERO;
  let seenInitial = false;
  const steps: LedgerStep[] = [];

  ordered.forEach((op, index) => {
    const qty = toDecimal(op.quantity);
    const price = toDecimal(op.unitPrice);
    const fees = toDecimal(op.fees);
    assertPositive(qty, "Quantidade", op.id);
    assertPositive(price, "Preço", op.id);
    if (fees.isNegative()) {
      throw new LedgerError("INVALID_VALUE", "Taxas não podem ser negativas.", op.id);
    }

    const { grossAmount, netAmount } = operationAmounts(op.type, qty, price, fees);
    let costOfSold: FinDecimal | null = null;
    let realizedResult: FinDecimal | null = null;

    switch (op.type) {
      case "INITIAL_BALANCE": {
        if (seenInitial) {
          throw new LedgerError(
            "DUPLICATE_INITIAL_BALANCE",
            "O fundo já possui um saldo inicial.",
            op.id,
          );
        }
        if (index !== 0) {
          throw new LedgerError(
            "INITIAL_BALANCE_NOT_FIRST",
            "O saldo inicial deve ser a primeira movimentação do fundo.",
            op.id,
          );
        }
        seenInitial = true;
        quantity = qty;
        // Exato: preserva o preço médio informado sem arredondamento.
        totalCost = qty.times(price);
        break;
      }
      case "BUY": {
        if (!op.tradeDate) {
          throw new LedgerError("MISSING_TRADE_DATE", "Compra sem data.", op.id);
        }
        quantity = quantity.plus(qty);
        totalCost = totalCost.plus(netAmount);
        break;
      }
      case "SELL": {
        if (!op.tradeDate) {
          throw new LedgerError("MISSING_TRADE_DATE", "Venda sem data.", op.id);
        }
        if (qty.gt(quantity)) {
          throw new LedgerError(
            "INSUFFICIENT_QUANTITY",
            `Quantidade insuficiente: venda de ${qty.toString()} cota(s) com saldo de ${quantity.toString()} na data da operação.`,
            op.id,
          );
        }
        // Proporcional ao custo total = preço médio anterior × qtd vendida, sem perda de precisão.
        costOfSold = totalCost.times(qty).dividedBy(quantity);
        realizedResult = netAmount.minus(costOfSold);
        quantity = quantity.minus(qty);
        totalCost = quantity.isZero() ? ZERO : totalCost.minus(costOfSold);
        realized = realized.plus(realizedResult);
        break;
      }
    }

    steps.push({
      id: op.id,
      type: op.type,
      quantity: qty,
      grossAmount,
      netAmount,
      quantityAfter: quantity,
      totalCostAfter: totalCost,
      averagePriceAfter: quantity.isZero()
        ? null
        : totalCost.dividedBy(quantity).toDecimalPlaces(SCALE.unitPrice),
      costOfSold,
      realizedResult,
    });
  });

  return { steps, final: { quantity, totalCost, realizedResult: realized } };
}
