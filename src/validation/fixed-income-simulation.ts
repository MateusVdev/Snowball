import { z } from "zod";
import { parseIsoDate } from "@/domain/dates";
import { MAX_SIMULATION_MONTHS } from "@/domain/fixed-income/simulation";
import { toDecimal } from "@/domain/money";
import { decimalString } from "./portfolio";

/**
 * Parâmetros do simulador de renda fixa. Os nomes dos campos são os do
 * formulário (e da URL), para os erros aparecerem no campo certo.
 */

const optionalDecimal = (label: string, max: string, maxScale: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v : undefined))
    .pipe(z.union([z.undefined(), decimalString({ label, maxScale, max })]))
    .transform((v) => v ?? null);

const amount = (label: string) =>
  z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() !== "" ? v : "0"))
    .pipe(decimalString({ label, maxScale: 2, max: "1000000000", allowZero: true }));

export const fixedIncomeSimulationSchema = z
  .object({
    initialAmount: amount("o valor inicial"),
    monthlyContribution: amount("o aporte mensal"),
    termValue: z.coerce.number({ error: "Informe o prazo." }).int("O prazo deve ser um número inteiro.").min(1, "O prazo deve ser de pelo menos 1."),
    termUnit: z.enum(["MONTHS", "YEARS"], { error: "Unidade do prazo inválida." }),
    rateMode: z.enum(["CDI_PERCENT", "ANNUAL_FIXED"], { error: "Escolha o tipo de rentabilidade." }),
    cdiPercent: optionalDecimal("o % do CDI", "1000", 4),
    annualRatePercent: optionalDecimal("a taxa anual", "100", 4),
    cdiAnnualPercent: optionalDecimal("o CDI anual", "100", 4),
    taxExempt: z
      .union([z.boolean(), z.string()])
      .nullish()
      .transform((v) => v === true || v === "on" || v === "1" || v === "true"),
    startDate: z
      .string()
      .refine((v) => parseIsoDate(v) !== null, "Data de início inválida."),
  })
  .superRefine((v, ctx) => {
    const months = v.termUnit === "YEARS" ? v.termValue * 12 : v.termValue;
    if (months > MAX_SIMULATION_MONTHS) {
      ctx.addIssue({ code: "custom", path: ["termValue"], message: `Prazo máximo: ${MAX_SIMULATION_MONTHS / 12} anos (${MAX_SIMULATION_MONTHS} meses).` });
    }
    if (toDecimal(v.initialAmount).plus(v.monthlyContribution).lte(0)) {
      ctx.addIssue({ code: "custom", path: ["initialAmount"], message: "Informe um valor inicial ou um aporte mensal." });
    }
    if (v.rateMode === "CDI_PERCENT") {
      if (!v.cdiPercent) ctx.addIssue({ code: "custom", path: ["cdiPercent"], message: "Informe o % do CDI (ex.: 115)." });
      if (!v.cdiAnnualPercent) ctx.addIssue({ code: "custom", path: ["cdiAnnualPercent"], message: "Informe o CDI anual estimado." });
    } else if (!v.annualRatePercent) {
      ctx.addIssue({ code: "custom", path: ["annualRatePercent"], message: "Informe a taxa anual (ex.: 12)." });
    }
  })
  .transform((v) => ({ ...v, months: v.termUnit === "YEARS" ? v.termValue * 12 : v.termValue }));

export type FixedIncomeSimulationFormInput = z.input<typeof fixedIncomeSimulationSchema>;
export type FixedIncomeSimulationConfig = z.infer<typeof fixedIncomeSimulationSchema>;

export const simulationNameSchema = z
  .string({ error: "Informe um nome." })
  .trim()
  .min(1, "Informe um nome.")
  .max(80, "Máximo de 80 caracteres.");
