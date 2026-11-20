import Decimal from "decimal.js";

/**
 * Primitivas numéricas do domínio financeiro.
 *
 * Regra de ouro (ver DOCUMENTATION/FINANCIAL_RULES.md): nenhum cálculo
 * financeiro usa `number` de ponto flutuante. Todos os valores são
 * convertidos para Decimal na entrada e o arredondamento acontece apenas
 * na apresentação ou na persistência, com a escala definida para cada grandeza.
 *
 * Este módulo é puro (sem I/O) e pode ser usado no servidor e no cliente.
 */

/** Instância isolada: não altera a configuração global do decimal.js. */
export const FinDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});
export type FinDecimal = InstanceType<typeof FinDecimal>;

/** Escalas (casas decimais) por grandeza. Espelham as colunas NUMERIC do banco. */
export const SCALE = {
  /** Valores em reais (totais, proventos recebidos, custos). */
  money: 2,
  /** Preço unitário de cota / provento por cota. */
  unitPrice: 8,
  /** Quantidade de cotas (FIIs negociam cotas inteiras; escala reservada para frações de desdobramento). */
  quantity: 8,
  /** Percentuais e taxas, armazenados como fração (0.0085 = 0,85%). */
  rate: 10,
} as const;

export type DecimalInput = FinDecimal | Decimal | string | number | bigint;

/**
 * Converte uma entrada para Decimal. Rejeita NaN/Infinity.
 * `number` só é aceito por conveniência em testes e constantes inteiras:
 * valores vindos de usuário/API devem chegar como string.
 */
export function toDecimal(value: DecimalInput): FinDecimal {
  const result =
    value instanceof FinDecimal
      ? value
      : new FinDecimal(
          typeof value === "bigint" ? value.toString() : (value as Decimal.Value),
        );
  if (!result.isFinite()) {
    throw new RangeError(`Valor numérico inválido: ${String(value)}`);
  }
  return result;
}

/** Arredonda para a escala indicada usando arredondamento comercial (half-up). */
export function roundTo(value: DecimalInput, scale: number): FinDecimal {
  return toDecimal(value).toDecimalPlaces(scale, FinDecimal.ROUND_HALF_UP);
}

export function roundMoney(value: DecimalInput): FinDecimal {
  return roundTo(value, SCALE.money);
}

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formata em reais. O arredondamento é feito em Decimal antes da conversão
 * para number, então o Intl apenas formata (não arredonda).
 */
export function formatBRL(value: DecimalInput): string {
  return brlFormatter.format(roundMoney(value).toNumber());
}

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formata uma fração (0.0123) como percentual pt-BR ("1,23%"), arredondando half-up. */
export function formatPercent(fraction: DecimalInput): string {
  return percentFormatter.format(roundTo(toDecimal(fraction).times(100), 2).dividedBy(100).toNumber());
}

/** Formata quantidade de cotas sem zeros desnecessários ("31", "1,5"). */
export function formatQuantity(value: DecimalInput): string {
  const d = toDecimal(value);
  const [intPart, fracPart] = d.toFixed().split(".");
  const intFormatted = new Intl.NumberFormat("pt-BR").format(BigInt(intPart));
  return fracPart ? `${intFormatted},${fracPart}` : intFormatted;
}

/** Preço unitário em reais com 2 a 8 casas (sem perder casas significativas). */
export function formatUnitPrice(value: DecimalInput): string {
  const d = roundTo(value, SCALE.unitPrice);
  const decimals = Math.max(2, d.decimalPlaces());
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(d.toNumber());
}

/**
 * Converte texto digitado (pt-BR ou ponto decimal) em string decimal canônica.
 * Regras: com vírgula → pontos são separadores de milhar e a vírgula é decimal
 * ("1.234,56"); sem vírgula → o ponto é decimal ("8.44"). Retorna null se inválido.
 */
export function parseDecimalInput(raw: string): string | null {
  const text = raw.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (text === "") return null;
  let normalized: string;
  if (text.includes(",")) {
    if (!/^(?:-?\d{1,3}(?:\.\d{3})*|-?\d+)(?:,\d+)?$/.test(text)) return null;
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else {
    if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
    normalized = text;
  }
  return toDecimal(normalized).toFixed();
}
