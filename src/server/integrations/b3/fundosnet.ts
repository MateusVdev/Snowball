import { z } from "zod";
import { parseIsoDate } from "@/domain/dates";
import { toDecimal } from "@/domain/money";
import { ProviderError } from "../errors";
import { httpGet, parseJson, type FetchLike } from "../http";
import { RequestLimiter } from "../limiter";
import type { DividendData, DividendProvider, DividendQuery } from "../types";

/**
 * B3 FundosNET — documentos oficiais publicados pelos administradores dos
 * fundos (https://fnet.bmfbovespa.com.br). Usa a categoria
 * "Aviso aos Cotistas - Estruturado" / tipo "Rendimentos e Amortizações",
 * cujo XML traz data-base (data-com), valor por cota, data de pagamento e
 * período de referência.
 *
 * - Exige o CNPJ do fundo.
 * - Não há API pública documentada nem chave: são as mesmas consultas da
 *   página pública. O site usa proteção anti-robô (Cloudflare) e bloqueia
 *   rajadas; por isso: 1 requisição por vez, intervalo mínimo de 5 s,
 *   poucos documentos por consulta e reaproveitamento dos já importados.
 * - Apenas documentos ativos (status "AC") são considerados.
 */

const PROVIDER = "B3 FundosNET";
const BASE = "https://fnet.bmfbovespa.com.br/fnet/publico";
const CATEGORY_STRUCTURED_NOTICE = "14";
const TYPE_DIVIDENDS = "41";

const listSchema = z.object({
  data: z.array(
    z.object({
      id: z.number().int(),
      status: z.string(),
      dataReferencia: z.string().nullable().optional(),
      dataEntrega: z.string().nullable().optional(),
      tipoDocumento: z.string().nullable().optional(),
    }),
  ),
});

/** "30/10/2026" → Date */
function brDate(value: string | null | undefined): Date | null {
  const m = value ? /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value) : null;
  return m ? parseIsoDate(`${m[3]}-${m[2]}-${m[1]}`) : null;
}

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
}

function decodeXmlText(value: string | null) {
  return value
    ?.replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&") ?? null;
}

/**
 * Extrai os proventos de um XML "Rendimentos e Amortizações" para o ticker.
 * Estrutura: InformeRendimentos > Provento (CodNegociacao) > Rendimento | Amortizacao.
 */
export function parseFundosNetXml(xml: string, ticker: string, documentId: string): DividendData[] {
  if (!xml.includes("<DadosEconomicoFinanceiros")) {
    throw new ProviderError("INVALID_RESPONSE", PROVIDER, "(documento não é XML estruturado — possível bloqueio do site)");
  }
  const out: DividendData[] = [];
  const proventos = xml.match(/<Provento>[\s\S]*?<\/Provento>/g) ?? [];
  for (const block of proventos) {
    if (tag(block, "CodNegociacao")?.toUpperCase() !== ticker) continue;
    const items = block.match(/<(Rendimento|Amortizacao)(\s[^>]*)?>[\s\S]*?<\/\1>/g) ?? [];
    for (const item of items) {
      const type = item.startsWith("<Amortizacao") ? "AMORTIZATION" : "INCOME";
      const rawValue = tag(item, "ValorProvento");
      const dataCom = parseIsoDate(tag(item, "DataBase") ?? "");
      if (!rawValue || !dataCom || !/^\d+(\.\d+)?$/.test(rawValue) || toDecimal(rawValue).lte(0)) {
        continue; // incompleto: ignorado, nunca preenchido com zero
      }
      const approval = tag(item, "AtoSocietarioAprovacao");
      out.push({
        ticker,
        type,
        ratePerShare: toDecimal(rawValue).toFixed(),
        dataCom,
        paymentDate: parseIsoDate(tag(item, "DataPagamento") ?? ""),
        approvedOn: approval ? parseIsoDate(approval) : null,
        referenceLabel: decodeXmlText(tag(item, "PeriodoReferencia")),
        verified: true, // documento oficial publicado pelo administrador
        externalId: `FNET:${documentId}:${type}`,
        remarks: null,
      });
    }
  }
  return out;
}

export interface FundosNetOptions {
  fetchImpl?: FetchLike;
  limiter?: RequestLimiter;
  timeoutMs?: number;
  /** Máximo de documentos consultados por fundo a cada importação. */
  maxDocuments?: number;
}

export class FundosNetProvider implements DividendProvider {
  readonly id = "B3_FUNDOSNET" as const;
  readonly name = "B3 FundosNET (documentos oficiais)";
  readonly requiresCnpj = true;
  private readonly limiter: RequestLimiter;

  constructor(private readonly opts: FundosNetOptions = {}) {
    this.limiter = opts.limiter ?? new RequestLimiter({ maxConcurrent: 1, minIntervalMs: 5000 });
  }

  private request(url: string) {
    return httpGet(url, {
      provider: PROVIDER,
      limiter: this.limiter,
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: this.opts.timeoutMs,
      headers: { "X-Requested-With": "XMLHttpRequest" },
      // 403 aqui é bloqueio anti-robô temporário do site, não restrição de plano.
      forbidden: { kind: "UNAVAILABLE", detail: "(acesso bloqueado temporariamente pelo site; tente mais tarde)" },
    });
  }

  async getDividends(query: DividendQuery): Promise<DividendData[]> {
    if (!query.cnpj || !/^\d{14}$/.test(query.cnpj)) {
      throw new ProviderError("NOT_CONFIGURED", PROVIDER, "(CNPJ do fundo não cadastrado)");
    }
    const params = new URLSearchParams({
      d: "1",
      s: "0",
      l: String(this.opts.maxDocuments ?? 6),
      "o[0][dataEntrega]": "desc",
      cnpjFundo: query.cnpj,
      idCategoriaDocumento: CATEGORY_STRUCTURED_NOTICE,
      idTipoDocumento: TYPE_DIVIDENDS,
      idEspecieDocumento: "0",
    });
    const { body } = await this.request(`${BASE}/pesquisarGerenciadorDocumentosDados?${params}`);
    const list = listSchema.safeParse(parseJson(body, PROVIDER));
    if (!list.success) throw new ProviderError("INVALID_RESPONSE", PROVIDER);

    // Documentos ativos com data de referência compatível com a janela pedida
    // (data-base costuma anteceder o pagamento em até ~1 mês).
    const minRef = new Date(query.from.getTime() - 45 * 24 * 3600 * 1000);
    const docs = list.data.data.filter((d) => {
      const ref = brDate(d.dataReferencia);
      return d.status === "AC" && (!ref || ref >= minRef);
    });

    const results: DividendData[] = [];
    for (const doc of docs) {
      const id = String(doc.id);
      const known = query.knownExternalIds;
      if (known && (known.has(`FNET:${id}:INCOME`) || known.has(`FNET:${id}:AMORTIZATION`))) continue;
      const { body: xml } = await this.request(`${BASE}/downloadDocumento?id=${encodeURIComponent(id)}`);
      results.push(...parseFundosNetXml(xml, query.ticker, id));
    }
    return results.filter((r) => !r.paymentDate || r.paymentDate >= query.from || r.dataCom >= query.from);
  }
}
