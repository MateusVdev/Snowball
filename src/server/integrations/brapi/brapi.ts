import { z } from "zod";
import { toDecimal } from "@/domain/money";
import { ProviderError } from "../errors";
import { httpGet, parseJson, type FetchLike } from "../http";
import { RequestLimiter } from "../limiter";
import type {
  AssetInformation,
  AssetInformationProvider,
  DailyPriceData,
  DividendData,
  DividendProvider,
  DividendQuery,
  PriceProvider,
  QuoteData,
} from "../types";

/**
 * Provedor brapi.dev (https://brapi.dev/docs). Endpoints usados:
 * - GET /api/v2/stocks/quote?symbols=     cotação atual (exige chave para FIIs)
 * - GET /api/v2/fii/historical?symbols=   preços diários (plano Pro; sem chave só MXRF11/HGLG11)
 * - GET /api/v2/fii/dividends?symbols=    rendimentos/amortizações (plano Pro; idem)
 * - GET /api/v2/fii/list?symbols=         dados cadastrais (plano Pro; idem)
 * Autenticação: header Authorization: Bearer <BRAPI_API_KEY>.
 * Limites: ver DOCUMENTATION/INTEGRATIONS.md.
 */

const PROVIDER = "brapi";
const BASE_URL = "https://brapi.dev";

const num = z.number().finite();
const numOrNull = num.nullable().optional();

const quoteSchema = z.object({
  results: z.array(
    z.object({
      symbol: z.string(),
      requestedSymbol: z.string().optional(),
      data: z.object({
        currency: z.string().nullable().optional(),
        regularMarketPrice: numOrNull,
        regularMarketPreviousClose: numOrNull,
        regularMarketChange: numOrNull,
        regularMarketChangePercent: numOrNull,
        regularMarketTime: z.string().nullable().optional(),
      }),
    }),
  ),
});

const historicalSchema = z.object({
  fiis: z.array(
    z.object({
      symbol: z.string(),
      historicalDataPrice: z.array(
        z.object({
          date: z.number().int(),
          open: numOrNull,
          high: numOrNull,
          low: numOrNull,
          close: numOrNull,
          volume: numOrNull,
          adjustedClose: numOrNull,
        }),
      ),
    }),
  ),
});

const dividendsSchema = z.object({
  dividends: z.array(
    z.object({
      symbol: z.string(),
      label: z.string(),
      lastDatePrior: z.string(),
      paymentDate: z.string().nullable(),
      approvedOn: z.string().nullable().optional(),
      rawRate: num,
      relatedTo: z.string().nullable().optional(),
      isinCode: z.string().nullable().optional(),
      remarks: z.string().nullable().optional(),
      verified: z.boolean().optional(),
    }),
  ),
});

const fiiListSchema = z.object({
  fiis: z.array(
    z.object({
      symbol: z.string(),
      name: z.string().nullable().optional(),
      cnpj: z.string().nullable().optional(),
      segmentoAtuacao: z.string().nullable().optional(),
      segmentType: z.string().nullable().optional(),
      administratorName: z.string().nullable().optional(),
    }),
  ),
});

/** number da API → string decimal > 0, ou null (nunca 0/NaN). */
export function positiveDecimal(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return toDecimal(String(value)).toFixed();
}

function decimalOrNull(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return toDecimal(String(value)).toFixed();
}

/**
 * Datas da brapi chegam como meia-noite de Brasília em UTC
 * ("2026-10-30T03:00:00.000Z") ou epoch em segundos. Converte para a data de
 * calendário em São Paulo (meia-noite UTC).
 */
export function brapiDateToCalendar(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const ms = typeof value === "number" ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const sp = new Date(ms - 3 * 3600 * 1000);
  return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate()));
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export interface BrapiOptions {
  apiKey?: string | null;
  fetchImpl?: FetchLike;
  limiter?: RequestLimiter;
  timeoutMs?: number;
  /** Quando a cotação atual não é permitida (401/403), usar o último fechamento do histórico. */
  dailyCloseFallback?: boolean;
}

export class BrapiProvider implements PriceProvider, DividendProvider, AssetInformationProvider {
  readonly id = "BRAPI" as const;
  readonly name = "brapi";
  readonly requiresCnpj = false;
  private readonly limiter: RequestLimiter;

  constructor(private readonly opts: BrapiOptions = {}) {
    // Gratuito: 1 requisição simultânea; sem chave: 20/min por IP (≈ 1 a cada 3 s).
    this.limiter =
      opts.limiter ??
      new RequestLimiter({ maxConcurrent: 1, minIntervalMs: opts.apiKey ? 250 : 3100 });
  }

  get hasApiKey() {
    return Boolean(this.opts.apiKey);
  }

  private async get(path: string, params: Record<string, string>) {
    const url = `${BASE_URL}${path}?${new URLSearchParams(params).toString()}`;
    const { body } = await httpGet(url, {
      provider: PROVIDER,
      limiter: this.limiter,
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: this.opts.timeoutMs,
      headers: this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : undefined,
    });
    return parseJson(body, PROVIDER);
  }

  private parse<T>(schema: z.ZodType<T>, data: unknown): T {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new ProviderError("INVALID_RESPONSE", PROVIDER, `(${parsed.error.issues[0]?.path.join(".")})`);
    }
    return parsed.data;
  }

  async getQuote(ticker: string): Promise<QuoteData> {
    try {
      const data = this.parse(quoteSchema, await this.get("/api/v2/stocks/quote", { symbols: ticker }));
      const item = data.results.find((r) => r.symbol === ticker) ?? data.results[0];
      if (!item) throw new ProviderError("NOT_FOUND", PROVIDER);
      const price = positiveDecimal(item.data.regularMarketPrice);
      const time = item.data.regularMarketTime ? new Date(item.data.regularMarketTime) : null;
      // Sem preço válido ou sem horário: não é cotação utilizável.
      if (!price || !time || Number.isNaN(time.getTime())) {
        throw new ProviderError("INVALID_RESPONSE", PROVIDER, "(cotação sem preço ou horário)");
      }
      return {
        ticker,
        price,
        previousClose: positiveDecimal(item.data.regularMarketPreviousClose),
        change: decimalOrNull(item.data.regularMarketChange),
        changePercent: decimalOrNull(item.data.regularMarketChangePercent),
        marketTime: time,
        kind: "QUOTE",
        currency: item.data.currency ?? null,
      };
    } catch (error) {
      const restricted =
        error instanceof ProviderError &&
        (error.kind === "UNAUTHORIZED" || error.kind === "PLAN_RESTRICTED");
      if (restricted && this.opts.dailyCloseFallback !== false) {
        return this.quoteFromDailyClose(ticker, error as ProviderError);
      }
      throw error;
    }
  }

  /** Último fechamento do histórico diário, identificado como tal (kind DAILY_CLOSE). */
  private async quoteFromDailyClose(ticker: string, original: ProviderError): Promise<QuoteData> {
    const to = new Date();
    const from = new Date(to.getTime() - 15 * 24 * 3600 * 1000);
    let rows: DailyPriceData[];
    try {
      rows = await this.getDailyHistory(ticker, from, to);
    } catch {
      throw original;
    }
    const sorted = rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    const last = sorted.at(-1);
    if (!last) throw original;
    const prev = sorted.at(-2) ?? null;
    const change = prev ? toDecimal(last.close).minus(prev.close) : null;
    return {
      ticker,
      price: last.close,
      previousClose: prev?.close ?? null,
      change: change ? change.toFixed() : null,
      changePercent: change && prev ? change.dividedBy(prev.close).times(100).toDecimalPlaces(6).toFixed() : null,
      // Fechamento do pregão: 18h de São Paulo (21h UTC) do dia.
      marketTime: new Date(last.date.getTime() + 21 * 3600 * 1000),
      kind: "DAILY_CLOSE",
      currency: "BRL",
    };
  }

  async getDailyHistory(ticker: string, from: Date, to: Date): Promise<DailyPriceData[]> {
    const data = this.parse(
      historicalSchema,
      await this.get("/api/v2/fii/historical", {
        symbols: ticker,
        startDate: isoDay(from),
        endDate: isoDay(to),
        sortOrder: "asc",
      }),
    );
    const series = data.fiis.find((f) => f.symbol === ticker);
    if (!series) throw new ProviderError("NOT_FOUND", PROVIDER);
    const out: DailyPriceData[] = [];
    for (const row of series.historicalDataPrice) {
      const close = positiveDecimal(row.close);
      const date = brapiDateToCalendar(row.date);
      if (!close || !date) continue; // linhas sem fechamento válido são ignoradas, nunca zeradas
      out.push({
        date,
        open: positiveDecimal(row.open),
        high: positiveDecimal(row.high),
        low: positiveDecimal(row.low),
        close,
        adjustedClose: positiveDecimal(row.adjustedClose),
        volume: row.volume !== null && row.volume !== undefined && Number.isFinite(row.volume) && row.volume >= 0
          ? String(Math.round(row.volume))
          : null,
      });
    }
    return out;
  }

  async getDividends(query: DividendQuery): Promise<DividendData[]> {
    const data = this.parse(
      dividendsSchema,
      await this.get("/api/v2/fii/dividends", {
        symbols: query.ticker,
        startDate: isoDay(query.from),
        sortBy: "paymentDate",
        sortOrder: "asc",
      }),
    );
    const out: DividendData[] = [];
    for (const d of data.dividends) {
      if (d.symbol !== query.ticker) continue;
      const rate = positiveDecimal(d.rawRate);
      const dataCom = brapiDateToCalendar(d.lastDatePrior);
      const label = d.label.trim().toUpperCase();
      const type = label.startsWith("AMORTIZA") ? "AMORTIZATION" : label === "RENDIMENTO" ? "INCOME" : null;
      if (!rate || !dataCom || !type) continue; // registro incompleto: ignorado (nunca preenchido)
      out.push({
        ticker: d.symbol,
        type,
        ratePerShare: rate,
        dataCom,
        paymentDate: brapiDateToCalendar(d.paymentDate),
        approvedOn: brapiDateToCalendar(d.approvedOn ?? null),
        referenceLabel: d.relatedTo?.trim() || null,
        verified: d.verified ?? null,
        externalId: d.isinCode ? `${d.isinCode}:${isoDay(dataCom)}:${type}` : null,
        remarks: d.remarks?.trim() || null,
      });
    }
    return out;
  }

  async getAssetInfo(ticker: string): Promise<AssetInformation> {
    const data = this.parse(fiiListSchema, await this.get("/api/v2/fii/list", { symbols: ticker }));
    const fii = data.fiis.find((f) => f.symbol === ticker);
    if (!fii) throw new ProviderError("NOT_FOUND", PROVIDER);
    const cnpj = fii.cnpj?.replace(/\D/g, "") ?? "";
    return {
      ticker,
      name: fii.name?.trim() || null,
      cnpj: cnpj.length === 14 ? cnpj : null,
      segment: fii.segmentoAtuacao?.trim() || null,
      segmentType: fii.segmentType?.trim() || null,
      administrator: fii.administratorName?.trim() || null,
    };
  }
}
