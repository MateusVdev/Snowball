import { z } from "zod";
import { addDays } from "@/domain/fixed-income/calendar";
import { toDecimal } from "@/domain/money";
import { ProviderError, isProviderError } from "../errors";
import { httpGet, parseJson, type FetchLike } from "../http";
import { RequestLimiter } from "../limiter";
import type { IndexDailyRateData, IndexRateProvider } from "../types";

/**
 * Banco Central do Brasil — Sistema Gerenciador de Séries Temporais (SGS).
 * API pública, gratuita e sem chave:
 *   https://api.bcb.gov.br/dados/serie/bcdata.sgs.{série}/dados?formato=json&dataInicial=DD/MM/AAAA&dataFinal=DD/MM/AAAA
 * - CDI diário: série 12 · Selic diária: série 11.
 * - Resposta: [{ "data": "DD/MM/AAAA", "valor": "0.055131" }] — taxa do DIA em %,
 *   somente dias úteis.
 * - Séries diárias aceitam no máximo 10 anos por consulta (HTTP 406 acima
 *   disso): janelas longas são divididas em blocos de até 5 anos.
 * - Intervalo sem dados responde HTTP 404 ("Value(s) not found"): tratado
 *   como lista vazia.
 */

const PROVIDER = "Banco Central (SGS)";
const BASE = "https://api.bcb.gov.br/dados/serie";
export const SGS_SERIES = { CDI: 12, SELIC: 11 } as const;
/** Tamanho máximo de cada consulta (dias corridos). */
export const SGS_MAX_WINDOW_DAYS = 5 * 365;

const responseSchema = z.array(
  z.object({
    data: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
    valor: z.string().regex(/^\d+(\.\d+)?$/),
  }),
);

/** "AAAA-MM-DD" → "DD/MM/AAAA" */
function toBr(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "DD/MM/AAAA" → "AAAA-MM-DD" */
function fromBr(br: string) {
  return `${br.slice(6, 10)}-${br.slice(3, 5)}-${br.slice(0, 2)}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Divide [from, to] em janelas contíguas de até `maxDays` dias. */
export function splitWindows(from: string, to: string, maxDays = SGS_MAX_WINDOW_DAYS): [string, string][] {
  const out: [string, string][] = [];
  for (let start = from; start <= to; ) {
    const candidate = addDays(start, maxDays - 1);
    const end = candidate < to ? candidate : to;
    out.push([start, end]);
    start = addDays(end, 1);
  }
  return out;
}

export function parseSgsResponse(body: string, from: string, to: string): IndexDailyRateData[] {
  const parsed = responseSchema.safeParse(parseJson(body, PROVIDER));
  if (!parsed.success) throw new ProviderError("INVALID_RESPONSE", PROVIDER);
  const out = new Map<string, IndexDailyRateData>();
  for (const row of parsed.data) {
    const date = fromBr(row.data);
    if (date < from || date > to) continue;
    out.set(date, { date, dailyRatePercent: toDecimal(row.valor).toFixed() });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface SgsOptions {
  fetchImpl?: FetchLike;
  limiter?: RequestLimiter;
  timeoutMs?: number;
}

export class BcbSgsProvider implements IndexRateProvider {
  readonly id = "BCB" as const;
  readonly name = "Banco Central (CDI/Selic)";
  private readonly limiter: RequestLimiter;

  constructor(private readonly opts: SgsOptions = {}) {
    this.limiter = opts.limiter ?? new RequestLimiter({ maxConcurrent: 1, minIntervalMs: 500 });
  }

  async getDailyRates(indexer: "CDI" | "SELIC", from: string, to: string): Promise<IndexDailyRateData[]> {
    if (!ISO.test(from) || !ISO.test(to) || from > to) {
      throw new ProviderError("INVALID_RESPONSE", PROVIDER, "(intervalo de datas inválido)");
    }
    const series = SGS_SERIES[indexer];
    const out: IndexDailyRateData[] = [];
    for (const [start, end] of splitWindows(from, to)) {
      const params = new URLSearchParams({ formato: "json", dataInicial: toBr(start), dataFinal: toBr(end) });
      try {
        const { body } = await httpGet(`${BASE}/bcdata.sgs.${series}/dados?${params}`, {
          provider: PROVIDER,
          limiter: this.limiter,
          fetchImpl: this.opts.fetchImpl,
          timeoutMs: this.opts.timeoutMs,
          forbidden: { kind: "UNAVAILABLE" },
        });
        out.push(...parseSgsResponse(body, start, end));
      } catch (error) {
        // 404 = nenhum valor no intervalo (ex.: só fim de semana / ainda não publicado).
        if (isProviderError(error) && error.kind === "NOT_FOUND") continue;
        throw error;
      }
    }
    return out;
  }
}
