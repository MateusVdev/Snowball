import { z } from "zod";
import { parseIsoDate, todayIsoDate } from "@/domain/dates";
import { parseDecimalInput, toDecimal } from "@/domain/money";
import { decimalString } from "./portfolio";

/**
 * Schemas Zod da renda fixa. Valores sempre como string decimal (nunca number).
 * Fase 1: apenas pós-fixados (% do CDI ou da Selic). PREFIXADO e TESOURO_IPCA
 * (e os indexadores PRE/IPCA) existem no banco, mas ainda não são aceitos.
 */

export const FIXED_INCOME_PRODUCT_TYPES = ["CDB", "RDB", "LCI", "LCA", "TESOURO_SELIC", "OUTRO"] as const;
export const FIXED_INCOME_INDEXERS = ["CDI", "SELIC"] as const;
export type FixedIncomeProductTypeInput = (typeof FIXED_INCOME_PRODUCT_TYPES)[number];

/** LCI e LCA são isentas de IR para pessoa física (padrão; editável). */
export function defaultTaxExempt(productType: string) {
  return productType === "LCI" || productType === "LCA";
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .nullish()
    .transform((value) => (value ? value : null));

/** Aceita boolean ou valores de formulário ("on", "true", "1", "false", "0"). */
const booleanInput = z
  .union([z.boolean(), z.enum(["on", "true", "1", "false", "0", ""])])
  .transform((v) => v === true || v === "on" || v === "true" || v === "1");

const isoDate = (label: string, opts: { notFuture?: boolean }) =>
  z.string({ error: `Informe ${label}.` }).transform((raw, ctx) => {
    const date = parseIsoDate(raw);
    if (!date) {
      ctx.addIssue({ code: "custom", message: "Data inválida." });
      return z.NEVER;
    }
    if (opts.notFuture && raw.trim() > todayIsoDate()) {
      ctx.addIssue({ code: "custom", message: "A data não pode estar no futuro." });
      return z.NEVER;
    }
    if (date.getUTCFullYear() < 1995 || date.getUTCFullYear() > 2100) {
      ctx.addIssue({ code: "custom", message: "Data fora do intervalo aceito." });
      return z.NEVER;
    }
    return date;
  });

/** Spread/ágio anual em % (pode ser negativo; vazio = sem spread). */
const spreadSchema = z
  .string()
  .nullish()
  .transform((raw, ctx) => {
    if (!raw || raw.trim() === "") return null;
    const trimmed = raw.trim();
    const negative = trimmed.startsWith("-");
    const parsed = parseDecimalInput(negative ? trimmed.slice(1) : trimmed);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "Spread inválido." });
      return z.NEVER;
    }
    const d = toDecimal(parsed).times(negative ? -1 : 1);
    if (d.decimalPlaces() > 4 || d.lte(-50) || d.gt(50)) {
      ctx.addIssue({ code: "custom", message: "Spread deve estar entre -50% e 50% ao ano, com até 4 casas." });
      return z.NEVER;
    }
    return d.isZero() ? null : d.toFixed();
  });

export const fixedIncomeAssetSchema = z
  .object({
    name: z.string({ error: "Informe o nome." }).trim().min(1, "Informe o nome.").max(80, "Máximo de 80 caracteres."),
    issuer: optionalText(80),
    productType: z.enum(FIXED_INCOME_PRODUCT_TYPES, { error: "Tipo de produto inválido." }),
    indexer: z.enum(FIXED_INCOME_INDEXERS, { error: "Indexador inválido (use CDI ou Selic)." }),
    rate: decimalString({ label: "o percentual do indexador", maxScale: 4, max: "1000" }),
    spreadAnnualPercent: spreadSchema,
    /** Omitido = padrão do tipo (LCI/LCA isentas). */
    taxExempt: booleanInput.optional(),
    dailyLiquidity: booleanInput.optional().transform((v) => v ?? true),
    maturityDate: z
      .string()
      .nullish()
      .transform((raw) => (raw && raw.trim() !== "" ? raw : null))
      .pipe(z.union([z.null(), isoDate("o vencimento", {})])),
    notes: optionalText(500),
  })
  .superRefine((value, ctx) => {
    if (value.productType === "TESOURO_SELIC" && value.indexer !== "SELIC") {
      ctx.addIssue({ code: "custom", path: ["indexer"], message: "Tesouro Selic usa o indexador Selic." });
    }
  })
  .transform((value) => ({ ...value, taxExempt: value.taxExempt ?? defaultTaxExempt(value.productType) }));

export type FixedIncomeAssetFormInput = z.input<typeof fixedIncomeAssetSchema>;
export type FixedIncomeAssetInput = z.infer<typeof fixedIncomeAssetSchema>;

export const fixedIncomeMovementSchema = z.object({
  type: z.enum(["DEPOSIT", "WITHDRAWAL"], { error: "Tipo de movimento inválido." }),
  date: isoDate("a data", { notFuture: true }),
  /** Aporte: valor aplicado. Resgate: valor LÍQUIDO recebido (o do extrato). */
  amount: decimalString({ label: "o valor", maxScale: 2, max: "1000000000" }),
  notes: optionalText(300),
});

export type FixedIncomeMovementFormInput = z.input<typeof fixedIncomeMovementSchema>;
export type FixedIncomeMovementInput = z.infer<typeof fixedIncomeMovementSchema>;
