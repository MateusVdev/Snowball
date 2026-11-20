import { z } from "zod";
import { parseIsoDate, todayIsoDate } from "@/domain/dates";
import { parseDecimalInput, toDecimal } from "@/domain/money";

/**
 * Schemas Zod da carteira. Valores numéricos são sempre transportados como
 * string decimal canônica ("8.44") — nunca number — até chegarem ao domínio.
 */

/** Ticker de FII: 4 letras + 2 dígitos (ex.: MXRF11). Normaliza para maiúsculas. */
export const tickerSchema = z
  .string({ error: "Informe o ticker." })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}\d{2}$/, "Ticker inválido. Use 4 letras e 2 dígitos (ex.: MXRF11).");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .optional()
    .transform((value) => (value ? value : null));

/**
 * Decimal digitado pelo usuário (aceita "1.234,56" e "8.44").
 * `maxScale` limita casas decimais; `allowZero` permite 0 (ex.: taxas).
 */
export function decimalString(opts: {
  label: string;
  maxScale: number;
  allowZero?: boolean;
  integer?: boolean;
  max?: string;
}) {
  return z
    .string({ error: `Informe ${opts.label}.` })
    .transform((raw, ctx) => {
      const parsed = parseDecimalInput(raw);
      if (parsed === null) {
        ctx.addIssue({ code: "custom", message: `${opts.label} inválido(a).` });
        return z.NEVER;
      }
      const d = toDecimal(parsed);
      if (d.isNegative() || (!opts.allowZero && d.isZero())) {
        ctx.addIssue({
          code: "custom",
          message: `${opts.label} deve ser ${opts.allowZero ? "maior ou igual a" : "maior que"} zero.`,
        });
        return z.NEVER;
      }
      if (opts.integer && !d.isInteger()) {
        ctx.addIssue({ code: "custom", message: `${opts.label} deve ser um número inteiro.` });
        return z.NEVER;
      }
      if (d.decimalPlaces() > opts.maxScale) {
        ctx.addIssue({
          code: "custom",
          message: `${opts.label}: no máximo ${opts.maxScale} casas decimais.`,
        });
        return z.NEVER;
      }
      if (opts.max && d.gt(opts.max)) {
        ctx.addIssue({ code: "custom", message: `${opts.label} acima do limite permitido.` });
        return z.NEVER;
      }
      return d.toFixed();
    });
}

/** FIIs são negociados em cotas inteiras. */
export const quantitySchema = decimalString({
  label: "a quantidade",
  maxScale: 0,
  integer: true,
  max: "100000000",
});
export const unitPriceSchema = decimalString({
  label: "o preço",
  maxScale: 8,
  max: "10000000",
});
export const feesSchema = decimalString({
  label: "as taxas",
  maxScale: 2,
  allowZero: true,
  max: "10000000",
});

/** Data do pregão: válida e não futura (referência: hoje em São Paulo). */
export const tradeDateSchema = z
  .string({ error: "Informe a data da operação." })
  .transform((raw, ctx) => {
    const date = parseIsoDate(raw);
    if (!date) {
      ctx.addIssue({ code: "custom", message: "Data inválida." });
      return z.NEVER;
    }
    if (raw.trim() > todayIsoDate()) {
      ctx.addIssue({ code: "custom", message: "A data não pode estar no futuro." });
      return z.NEVER;
    }
    if (date.getUTCFullYear() < 1990) {
      ctx.addIssue({ code: "custom", message: "Data muito antiga." });
      return z.NEVER;
    }
    return date;
  });

const optionalDateSchema = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (!raw || raw.trim() === "") return null;
    const date = parseIsoDate(raw);
    if (!date) {
      ctx.addIssue({ code: "custom", message: "Data inválida." });
      return z.NEVER;
    }
    return date;
  });

export const fundInfoSchema = z.object({
  name: optionalText(120),
  segment: optionalText(60),
  notes: optionalText(500),
});

export const manualQuoteSchema = z.object({
  price: unitPriceSchema,
  referenceDate: optionalDateSchema,
  note: optionalText(200),
});
export type ManualQuoteInput = z.infer<typeof manualQuoteSchema>;

export const initialBalanceSchema = z.object({
  quantity: quantitySchema,
  averagePrice: unitPriceSchema,
  notes: optionalText(500),
});
export type InitialBalanceInput = z.infer<typeof initialBalanceSchema>;

export const createFundSchema = fundInfoSchema.extend({ ticker: tickerSchema });
export type CreateFundInput = z.input<typeof createFundSchema>;
export type FundInfoInput = z.infer<typeof fundInfoSchema>;

export const tradeSchema = z.object({
  type: z.enum(["BUY", "SELL"], { error: "Tipo de operação inválido." }),
  tradeDate: tradeDateSchema,
  quantity: quantitySchema,
  unitPrice: unitPriceSchema,
  fees: feesSchema,
  notes: optionalText(500),
});
export type TradeInput = z.infer<typeof tradeSchema>;

export const reasonSchema = z
  .string({ error: "Informe o motivo." })
  .trim()
  .min(5, "Descreva o motivo (mínimo de 5 caracteres).")
  .max(500, "Máximo de 500 caracteres.");

export const historyFilterSchema = z.object({
  fund: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => (v && /^[A-Z]{4}\d{2}$/.test(v) ? v : undefined)),
  from: optionalDateSchema.catch(null),
  to: optionalDateSchema.catch(null),
  type: z.enum(["INITIAL_BALANCE", "BUY", "SELL"]).optional().catch(undefined),
  status: z.enum(["active", "all"]).optional().catch(undefined),
});
export type HistoryFilter = z.infer<typeof historyFilterSchema>;

/** Tipos de ENTRADA (antes do parse), como chegam de formulários/scripts. */
export type TradeFormInput = z.input<typeof tradeSchema>;
export type InitialBalanceFormInput = z.input<typeof initialBalanceSchema>;
export type ManualQuoteFormInput = z.input<typeof manualQuoteSchema>;
export type FundInfoFormInput = z.input<typeof fundInfoSchema>;
