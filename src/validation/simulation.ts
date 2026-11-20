import { z } from "zod";
import { parseDecimalInput, toDecimal } from "@/domain/money";
import {
  ENGINE_VERSION,
  MAX_FUNDS,
  MAX_MONTHS,
  REINVESTMENT_OPTIONS,
  type SimulationConfig,
} from "@/domain/simulation/types";
import { DEFAULT_SCENARIOS } from "@/domain/simulation/scenarios";

/**
 * Validação da configuração de simulação (vinda do editor como JSON).
 * Números aceitam "8,44" ou "8.44" e são normalizados para string decimal.
 */

const dec = (label: string, opts: { min?: string; minExclusive?: string; max?: string; scale?: number; integer?: boolean } = {}) =>
  z.union([z.string(), z.number()]).transform((raw, ctx) => {
    const parsed = parseDecimalInput(String(raw));
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: `${label}: valor inválido.` });
      return z.NEVER;
    }
    const d = toDecimal(parsed);
    const fail = (message: string) => {
      ctx.addIssue({ code: "custom", message: `${label}: ${message}` });
      return z.NEVER;
    };
    if (opts.integer && !d.isInteger()) return fail("deve ser inteiro.");
    if (opts.scale !== undefined && d.decimalPlaces() > opts.scale) return fail(`no máximo ${opts.scale} casas decimais.`);
    if (opts.min !== undefined && d.lt(opts.min)) return fail(`mínimo ${opts.min}.`);
    if (opts.minExclusive !== undefined && d.lte(opts.minExclusive)) return fail(`deve ser maior que ${opts.minExclusive}.`);
    if (opts.max !== undefined && d.gt(opts.max)) return fail(`máximo ${opts.max}.`);
    return d.toFixed();
  });

const month = (max: number) => z.coerce.number().int().min(1).max(max);
const day = z.coerce.number().int().min(1, "Dia entre 1 e 28.").max(28, "Dia entre 1 e 28.");
const rate = (label: string) => dec(label, { minExclusive: "-100", max: "1000", scale: 6 });

const growthSchema = (label: string) =>
  z.object({ mode: z.enum(["CONSTANT", "MONTHLY", "ANNUAL"]), ratePercent: rate(label) });

const changeSchema = (label: string, scale: number) =>
  z.object({ month: month(MAX_MONTHS), value: dec(label, { min: "0", scale, max: "10000000" }) });

const key = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/);

const fundSchema = z.object({
  key,
  ticker: z.string().trim().toUpperCase().min(1, "Informe o ticker.").max(12),
  initialQuantity: dec("Quantidade inicial", { min: "0", integer: true, max: "100000000" }),
  price: dec("Preço", { minExclusive: "0", scale: 2, max: "10000000" }),
  monthlyDividend: dec("Dividendo mensal por cota", { min: "0", scale: 8, max: "1000000" }),
  priceGrowth: growthSchema("Variação do preço"),
  dividendGrowth: growthSchema("Variação do dividendo"),
  priceChanges: z.array(changeSchema("Alteração de preço", 2)).max(120).default([]),
  dividendChanges: z.array(changeSchema("Alteração de dividendo", 8)).max(120).default([]),
  reinvestmentPercent: z.enum(REINVESTMENT_OPTIONS),
  calendar: z.object({ dataComDay: day, paymentDay: day, paymentLagMonths: z.coerce.number().int().min(0).max(3) }),
});

const weights = z.record(key, dec("Percentual", { min: "0", max: "100", scale: 4 }));

export const simulationConfigSchema = z
  .object({
    engineVersion: z.string().optional().transform(() => ENGINE_VERSION),
    months: month(MAX_MONTHS),
    startMonth: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null)),
    timing: z.enum(["MONTHLY", "CALENDAR"]),
    purchaseDay: day,
    initialSharesEligibleBeforeStart: z.boolean(),
    initialCash: dec("Saldo inicial", { min: "0", scale: 2, max: "100000000" }),
    monthlyContribution: dec("Aporte mensal", { min: "0", scale: 2, max: "100000000" }),
    extraContributions: z
      .array(z.object({ month: month(MAX_MONTHS), amount: dec("Aporte extraordinário", { minExclusive: "0", scale: 2, max: "100000000" }), fundKey: key.nullable() }))
      .max(240),
    allocation: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("SAME_FUND"), contributionWeights: weights }),
      z.object({ mode: z.literal("WEIGHTS"), weights }),
      z.object({
        mode: z.literal("MANUAL"),
        purchases: z.array(z.object({ month: month(MAX_MONTHS), fundKey: key, quantity: z.coerce.number().int().min(1).max(1_000_000) })).max(2000),
      }),
    ]),
    funds: z.array(fundSchema).min(1, "Inclua ao menos um fundo.").max(MAX_FUNDS),
    goals: z
      .array(z.object({ id: key, label: z.string().trim().min(1).max(60), metric: z.enum(["MONTHLY_INCOME", "TOTAL_SHARES", "PATRIMONY", "TOTAL_DIVIDENDS"]), target: dec("Meta", { minExclusive: "0", max: "1000000000" }) }))
      .max(20),
    scenarios: z
      .array(z.object({
        key: z.enum(["REFERENCE", "CONSERVATIVE", "MODERATE", "OPTIMISTIC"]),
        label: z.string().trim().min(1).max(40),
        priceAnnualPercent: rate("Cenário: preço"),
        dividendAnnualPercent: rate("Cenário: dividendo"),
      }))
      .max(4)
      .default(DEFAULT_SCENARIOS),
  })
  .superRefine((cfg, ctx) => {
    const keys = new Set(cfg.funds.map((f) => f.key));
    if (keys.size !== cfg.funds.length) ctx.addIssue({ code: "custom", path: ["funds"], message: "Fundos duplicados." });
    const tickers = new Set(cfg.funds.map((f) => f.ticker));
    if (tickers.size !== cfg.funds.length) ctx.addIssue({ code: "custom", path: ["funds"], message: "Ticker repetido na simulação." });
    const checkKey = (k: string | null, path: (string | number)[]) => {
      if (k && !keys.has(k)) ctx.addIssue({ code: "custom", path, message: "Fundo de destino inexistente." });
    };
    cfg.extraContributions.forEach((e, i) => {
      checkKey(e.fundKey, ["extraContributions", i, "fundKey"]);
      if (e.month > cfg.months) ctx.addIssue({ code: "custom", path: ["extraContributions", i, "month"], message: "Aporte extraordinário fora do prazo." });
    });
    const a = cfg.allocation;
    if (a.mode === "MANUAL") a.purchases.forEach((p, i) => checkKey(p.fundKey, ["allocation", "purchases", i, "fundKey"]));
    else {
      const w = a.mode === "SAME_FUND" ? a.contributionWeights : a.weights;
      Object.keys(w).forEach((k) => checkKey(k, ["allocation"]));
      const sum = Object.values(w).reduce((acc, v) => acc.plus(v), toDecimal(0));
      if (a.mode === "WEIGHTS" && !sum.equals(100)) {
        ctx.addIssue({ code: "custom", path: ["allocation"], message: `Os percentuais devem somar 100% (somam ${sum.toFixed()}%).` });
      }
      if (a.mode === "SAME_FUND" && Object.keys(w).length > 0 && !sum.equals(100)) {
        ctx.addIssue({ code: "custom", path: ["allocation"], message: `Os percentuais dos aportes devem somar 100% (somam ${sum.toFixed()}%).` });
      }
    }
    if (cfg.timing === "CALENDAR") {
      cfg.funds.forEach((f, i) => {
        if (f.calendar.paymentLagMonths === 0 && f.calendar.paymentDay <= f.calendar.dataComDay) {
          ctx.addIssue({ code: "custom", path: ["funds", i, "calendar"], message: `${f.ticker}: pagamento no mesmo mês precisa ser depois da data-com.` });
        }
      });
    }
  });

export function parseSimulationConfig(input: unknown): SimulationConfig {
  return simulationConfigSchema.parse(input) as SimulationConfig;
}

export const simulationMetaSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome à simulação.").max(80),
  description: z.string().trim().max(500).nullish().transform((v) => (v ? v : null)),
});
