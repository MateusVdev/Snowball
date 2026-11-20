import { z } from "zod";
import { parseIsoDate } from "@/domain/dates";
import { decimalString, quantitySchema } from "./portfolio";

/** Schemas de proventos. Valores por cota com até 10 casas (fontes oficiais usam 9). */

const dateField = (label: string) =>
  z.string({ error: `Informe ${label}.` }).transform((raw, ctx) => {
    const date = parseIsoDate(raw ?? "");
    if (!date) {
      ctx.addIssue({ code: "custom", message: `${label[0].toUpperCase()}${label.slice(1)} inválida.` });
      return z.NEVER;
    }
    return date;
  });

const optionalDate = z
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

export const ratePerShareSchema = decimalString({ label: "o valor por cota", maxScale: 10, max: "100000" });

export const dividendEventSchema = z
  .object({
    fundId: z.string({ error: "Selecione o fundo." }).min(1, "Selecione o fundo."),
    kind: z.enum(["OFFICIAL", "FORECAST"], { error: "Selecione a natureza." }),
    type: z.enum(["INCOME", "AMORTIZATION"], { error: "Selecione o tipo." }),
    ratePerShare: ratePerShareSchema,
    dataCom: dateField("a data-com"),
    paymentDate: optionalDate,
    competence: z
      .string()
      .optional()
      .transform((v, ctx) => {
        const t = (v ?? "").trim();
        if (t === "") return null;
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(t)) {
          ctx.addIssue({ code: "custom", message: "Competência no formato AAAA-MM." });
          return z.NEVER;
        }
        return t;
      }),
    notes: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
  })
  .superRefine((data, ctx) => {
    if (data.paymentDate && data.paymentDate < data.dataCom) {
      ctx.addIssue({ code: "custom", path: ["paymentDate"], message: "O pagamento não pode ser antes da data-com." });
    }
  });
export type DividendEventFormInput = z.input<typeof dividendEventSchema>;

export const receiptSchema = z.object({
  quantity: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v || v.trim() === "") return null;
      const parsed = quantitySchema.safeParse(v);
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: parsed.error.issues[0].message });
        return z.NEVER;
      }
      return parsed.data;
    }),
  notes: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
});
export type ReceiptFormInput = z.input<typeof receiptSchema>;
