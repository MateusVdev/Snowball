import { describe, expect, it, vi } from "vitest";
import { BrapiProvider, brapiDateToCalendar } from "@/server/integrations/brapi/brapi";
import { FundosNetProvider, parseFundosNetXml } from "@/server/integrations/b3/fundosnet";
import { TtlCache } from "@/server/integrations/cache";
import { RequestLimiter } from "@/server/integrations/limiter";
import { ProviderError } from "@/server/integrations/errors";

/**
 * RESPOSTAS SIMULADAS — existem somente nestes testes. O formato segue a
 * documentação/OpenAPI da brapi (https://brapi.dev/openapi.json) e o XML
 * estruturado do FundosNET, conferidos em consultas reais durante o
 * desenvolvimento. Os valores aqui são de teste.
 */
const fastLimiter = () => new RequestLimiter({ maxConcurrent: 1, minIntervalMs: 0 });

function mockFetch(routes: Record<string, { status?: number; body: unknown; headers?: Record<string, string> } | (() => never)>) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`rota não simulada: ${url}`);
    const route = routes[key];
    if (typeof route === "function") return route();
    const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(body, { status: route.status ?? 200, headers: route.headers });
  });
}

const QUOTE_OK = {
  results: [{
    requestedSymbol: "MXRF11", symbol: "MXRF11", changed: false,
    data: {
      shortName: "MXRF11", longName: "Teste", currency: "BRL",
      regularMarketPrice: 8.56, regularMarketPreviousClose: 8.6, regularMarketChange: -0.04,
      regularMarketChangePercent: -0.47, regularMarketTime: "2026-11-19T21:30:30.000Z",
    },
  }],
  requestedAt: "2026-11-20T01:00:00.000Z", took: 1,
};

const HISTORY_OK = {
  fiis: [{
    symbol: "HGLG11",
    historicalDataPrice: [
      { date: 1794884400, open: 143.12, high: 144.13, low: 142.7, close: 142.99, volume: 96259, adjustedClose: 142.99 },
      { date: 1794970800, open: 142.99, high: 142.99, low: 141.9, close: 142.65, volume: 90851, adjustedClose: 142.65 },
      { date: 1795057200, open: null, high: null, low: null, close: null, volume: null, adjustedClose: null },
    ],
  }],
};

const DIVIDENDS_OK = {
  dividends: [
    { symbol: "MXRF11", approvedOn: null, label: "RENDIMENTO", lastDatePrior: "2026-10-30T03:00:00.000Z", exDate: null, paymentDate: "2026-11-16T03:00:00.000Z", rate: 0.095, rawRate: 0.095, relatedTo: "Outubro-2026", isinCode: "BRMXRFCTF008", remarks: "", verified: true },
    { symbol: "MXRF11", approvedOn: null, label: "AMORTIZAÇÃO", lastDatePrior: "2026-09-30T03:00:00.000Z", exDate: null, paymentDate: "2026-10-15T03:00:00.000Z", rate: 0.05, rawRate: 0.05, relatedTo: "Setembro-2026", isinCode: "BRMXRFCTF008", remarks: null, verified: false },
    { symbol: "MXRF11", approvedOn: null, label: "RENDIMENTO", lastDatePrior: "2026-08-31T03:00:00.000Z", exDate: null, paymentDate: "2026-09-15T03:00:00.000Z", rate: 0, rawRate: 0, relatedTo: "Agosto-2026", isinCode: null, remarks: null, verified: true },
  ],
};

describe("brapi — cotação", () => {
  it("consulta por ticker com chave no header e converte os campos", async () => {
    const fetchImpl = mockFetch({ "/api/v2/stocks/quote": { body: QUOTE_OK } });
    const p = new BrapiProvider({ apiKey: "chave-de-teste-123", fetchImpl, limiter: fastLimiter() });
    const q = await p.getQuote("MXRF11");
    expect(q).toMatchObject({ ticker: "MXRF11", price: "8.56", previousClose: "8.6", change: "-0.04", changePercent: "-0.47", kind: "QUOTE" });
    expect(q.marketTime.toISOString()).toBe("2026-11-19T21:30:30.000Z");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://brapi.dev/api/v2/stocks/quote?symbols=MXRF11");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer chave-de-teste-123");
  });

  it("sem chave (401): usa o último fechamento do histórico, identificado como tal", async () => {
    const fetchImpl = mockFetch({
      "/api/v2/stocks/quote": { status: 401, body: { error: true, message: "Token de autenticação não fornecido", code: "MISSING_TOKEN" } },
      "/api/v2/fii/historical": { body: HISTORY_OK },
    });
    const p = new BrapiProvider({ fetchImpl, limiter: fastLimiter() });
    const q = await p.getQuote("HGLG11");
    // Último fechamento válido 142,65 (linha nula ignorada); anterior 142,99
    expect(q).toMatchObject({ kind: "DAILY_CLOSE", price: "142.65", previousClose: "142.99", change: "-0.34" });
    expect(q.changePercent).toBe("-0.237779");
    expect(q.marketTime.toISOString()).toBe("2026-11-18T21:00:00.000Z");
  });

  it("sem fallback, 401 vira erro de autorização", async () => {
    const p = new BrapiProvider({ fetchImpl: mockFetch({ "/stocks/quote": { status: 401, body: {} } }), limiter: fastLimiter(), dailyCloseFallback: false });
    await expect(p.getQuote("MXRF11")).rejects.toMatchObject({ kind: "UNAUTHORIZED" });
  });

  it.each([
    [403, "PLAN_RESTRICTED"],
    [404, "NOT_FOUND"],
    [500, "UNAVAILABLE"],
    [503, "UNAVAILABLE"],
  ])("HTTP %i → %s", async (status, kind) => {
    const p = new BrapiProvider({ apiKey: "chave-de-teste-123", fetchImpl: mockFetch({ "/stocks/quote": { status, body: {} } }), limiter: fastLimiter(), dailyCloseFallback: false });
    await expect(p.getQuote("MXRF11")).rejects.toMatchObject({ kind });
  });

  it("429: respeita Retry-After e pausa as próximas chamadas", async () => {
    const fetchImpl = mockFetch({ "/stocks/quote": { status: 429, body: {}, headers: { "Retry-After": "30" } } });
    const p = new BrapiProvider({ apiKey: "chave-de-teste-123", fetchImpl, limiter: fastLimiter() });
    await expect(p.getQuote("MXRF11")).rejects.toMatchObject({ kind: "RATE_LIMITED", retryAfterSeconds: 30 });
    await expect(p.getQuote("MXRF11")).rejects.toMatchObject({ kind: "RATE_LIMITED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // a segunda nem saiu
  });

  it("falha de rede, timeout e resposta inválida", async () => {
    const down = new BrapiProvider({ apiKey: "chave-de-teste-123", fetchImpl: vi.fn(async () => { throw new TypeError("fetch failed"); }), limiter: fastLimiter() });
    await expect(down.getQuote("MXRF11")).rejects.toMatchObject({ kind: "UNAVAILABLE" });

    const slow = new BrapiProvider({
      apiKey: "chave-de-teste-123",
      timeoutMs: 20,
      limiter: fastLimiter(),
      fetchImpl: (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    });
    await expect(slow.getQuote("MXRF11")).rejects.toMatchObject({ kind: "TIMEOUT" });

    const html = new BrapiProvider({ apiKey: "chave-de-teste-123", fetchImpl: mockFetch({ "/stocks/quote": { body: "<html>erro</html>" } }), limiter: fastLimiter() });
    await expect(html.getQuote("MXRF11")).rejects.toMatchObject({ kind: "INVALID_RESPONSE" });
  });

  it("preço zero/nulo nunca vira cotação", async () => {
    const zero = structuredClone(QUOTE_OK);
    zero.results[0].data.regularMarketPrice = 0;
    const p = new BrapiProvider({ apiKey: "chave-de-teste-123", fetchImpl: mockFetch({ "/stocks/quote": { body: zero } }), limiter: fastLimiter() });
    await expect(p.getQuote("MXRF11")).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("brapi — proventos e cadastro", () => {
  it("converte datas (meia-noite de Brasília) e tipos; ignora registros sem valor", async () => {
    const p = new BrapiProvider({ fetchImpl: mockFetch({ "/api/v2/fii/dividends": { body: DIVIDENDS_OK } }), limiter: fastLimiter() });
    const rows = await p.getDividends({ ticker: "MXRF11", cnpj: null, from: new Date("2025-10-01T00:00:00Z") });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: "INCOME", ratePerShare: "0.095", referenceLabel: "Outubro-2026", verified: true, externalId: "BRMXRFCTF008:2026-10-30:INCOME" });
    expect(rows[0].dataCom.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(rows[0].paymentDate?.toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(rows[1]).toMatchObject({ type: "AMORTIZATION", verified: false });
  });

  it("dados cadastrais como sugestão", async () => {
    const p = new BrapiProvider({
      fetchImpl: mockFetch({ "/api/v2/fii/list": { body: { fiis: [{ symbol: "MXRF11", name: "FII TESTE", cnpj: "97521225000125", segmentoAtuacao: "Logística", segmentType: "papel", administratorName: "ADM" }] } } }),
      limiter: fastLimiter(),
    });
    expect(await p.getAssetInfo("MXRF11")).toEqual({ ticker: "MXRF11", name: "FII TESTE", cnpj: "97521225000125", segment: "Logística", segmentType: "papel", administrator: "ADM" });
  });

  it("datas em epoch e ISO", () => {
    expect(brapiDateToCalendar(1794970800)?.toISOString()).toBe("2026-11-18T00:00:00.000Z");
    expect(brapiDateToCalendar("2026-10-30T03:00:00.000Z")?.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(brapiDateToCalendar(null)).toBeNull();
  });
});

const FNET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DadosEconomicoFinanceiros><DadosGerais><CNPJFundo>97521225000125</CNPJFundo></DadosGerais>
<InformeRendimentos>
  <Provento><CodISIN>BRMXRFCTF008</CodISIN><CodNegociacao>MXRF11</CodNegociacao>
    <Rendimento><AtoSocietarioAprovacao/><DataBase>2026-10-30</DataBase><ValorProvento>0.095</ValorProvento><DataPagamento>2026-11-16</DataPagamento><PeriodoReferencia>Outubro-2026</PeriodoReferencia><RendimentoIsentoIR>Sim</RendimentoIsentoIR></Rendimento>
    <Amortizacao tipo="Parcial"><AtoSocietarioAprovacao/><DataBase>2026-10-30</DataBase><ValorProvento>0.308363541</ValorProvento><DataPagamento>2026-11-27</DataPagamento><PeriodoReferencia>Novembro-2026</PeriodoReferencia></Amortizacao>
  </Provento>
  <Provento><CodISIN>BROUTRO00000</CodISIN><CodNegociacao>OUTR11</CodNegociacao>
    <Rendimento><DataBase>2026-10-30</DataBase><ValorProvento>9.99</ValorProvento><DataPagamento>2026-11-16</DataPagamento></Rendimento>
  </Provento>
</InformeRendimentos></DadosEconomicoFinanceiros>`;

describe("B3 FundosNET — documentos oficiais", () => {
  it("extrai rendimento e amortização (9 casas) do XML estruturado, só do ticker pedido", () => {
    const rows = parseFundosNetXml(FNET_XML, "MXRF11", "1365016");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: "INCOME", ratePerShare: "0.095", referenceLabel: "Outubro-2026", verified: true, externalId: "FNET:1365016:INCOME" });
    expect(rows[1]).toMatchObject({ type: "AMORTIZATION", ratePerShare: "0.308363541" });
  });

  it("página de bloqueio (HTML) é tratada como falha, nunca como dado", () => {
    expect(() => parseFundosNetXml("<!DOCTYPE html><title>Attention Required! | Cloudflare</title>", "MXRF11", "1")).toThrow(ProviderError);
  });

  it("exige CNPJ, considera só documentos ativos e reaproveita os já importados", async () => {
    const fetchImpl = mockFetch({
      pesquisarGerenciadorDocumentosDados: {
        body: { data: [
          { id: 3, status: "AC", dataReferencia: "30/10/2026" },
          { id: 2, status: "CC", dataReferencia: "30/10/2026" },
          { id: 1, status: "AC", dataReferencia: "30/09/2026" },
        ] },
      },
      "downloadDocumento?id=3": { body: FNET_XML },
    });
    const p = new FundosNetProvider({ fetchImpl, limiter: fastLimiter() });
    await expect(p.getDividends({ ticker: "MXRF11", cnpj: null, from: new Date("2025-11-01") })).rejects.toMatchObject({ kind: "NOT_CONFIGURED" });
    const rows = await p.getDividends({
      ticker: "MXRF11", cnpj: "97521225000125", from: new Date("2025-11-01"),
      knownExternalIds: new Set(["FNET:1:INCOME"]),
    });
    expect(rows).toHaveLength(2);
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("downloadDocumento?id=2"))).toBe(false); // cancelado
    expect(urls.some((u) => u.includes("downloadDocumento?id=1"))).toBe(false); // já importado
  });
});

describe("cache e controle de requisições", () => {
  it("cache com TTL: reaproveita dentro do prazo, recarrega depois; erros não são guardados", async () => {
    let now = 0;
    const cache = new TtlCache<string>(10, () => now);
    const load = vi.fn(async () => "valor");
    expect(await cache.getOrLoad("k", 1000, load)).toEqual({ value: "valor", cached: false });
    expect(await cache.getOrLoad("k", 1000, load)).toEqual({ value: "valor", cached: true });
    now = 1001;
    expect((await cache.getOrLoad("k", 1000, load)).cached).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
    await expect(cache.getOrLoad("e", 1000, async () => { throw new Error("x"); })).rejects.toThrow();
    expect(cache.get("e")).toBeUndefined();
  });

  it("limitador: uma requisição por vez e intervalo mínimo", async () => {
    let now = 10_000;
    const sleeps: number[] = [];
    const limiter = new RequestLimiter({ maxConcurrent: 1, minIntervalMs: 3000 }, () => now, async (ms) => { sleeps.push(ms); now += ms; });
    let active = 0;
    let maxActive = 0;
    const task = async () => { active++; maxActive = Math.max(maxActive, active); await Promise.resolve(); active--; };
    await Promise.all([limiter.run(task), limiter.run(task), limiter.run(task)]);
    expect(maxActive).toBe(1);
    expect(sleeps).toEqual([3000, 3000]);
  });
});
