import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "@/server/auth/service";
import { addManualQuote, createFund, getFundByTicker } from "@/server/services/portfolio/fund-service";
import { registerTrade } from "@/server/services/portfolio/operation-service";
import { refreshQuotes } from "@/server/services/market/quote-service";
import { importDividends } from "@/server/services/dividends/import-service";
import {
  confirmPendingReceipts,
  confirmReceipt,
  getDividendsOverview,
  listDividendEvents,
  registerDividendEvent,
  voidDividendEvent,
  voidReceipt,
} from "@/server/services/dividends/dividend-service";
import { maybeAutoRefresh, updateUserSettings } from "@/server/services/market/auto-refresh";
import { ProviderError } from "@/server/integrations/errors";
import { TtlCache } from "@/server/integrations/cache";
import type { DividendData, DividendProvider, PriceProvider, QuoteData } from "@/server/integrations/types";
import type { Integrations } from "@/server/integrations/registry";
import { createPrismaClient } from "@/server/db/factory";
import { createTestDb, resetDatabase } from "../support/db";

/** Provedores FALSOS — usados somente nestes testes. */
function fakePriceProvider(impl: (ticker: string) => Promise<QuoteData>): PriceProvider & { calls: number } {
  const p = {
    id: "BRAPI" as const,
    name: "brapi (simulado)",
    calls: 0,
    async getQuote(ticker: string) {
      p.calls += 1;
      return impl(ticker);
    },
  };
  return p;
}

function fakeDividendProvider(data: Record<string, DividendData[] | Error>, opts: { id?: "BRAPI" | "B3_FUNDOSNET"; requiresCnpj?: boolean } = {}): DividendProvider {
  return {
    id: opts.id ?? "BRAPI",
    name: `${opts.id ?? "BRAPI"} (simulado)`,
    requiresCnpj: opts.requiresCnpj ?? false,
    async getDividends({ ticker }) {
      const r = data[ticker] ?? [];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const quote = (ticker: string, price: string, time: string, kind: "QUOTE" | "DAILY_CLOSE" = "QUOTE"): QuoteData => ({
  ticker, price, previousClose: "8.60", change: "-0.04", changePercent: "-0.47", marketTime: new Date(time), kind, currency: "BRL",
});
const div = (ticker: string, dataCom: string, pay: string | null, rate: string, extra: Partial<DividendData> = {}): DividendData => ({
  ticker, type: "INCOME", ratePerShare: rate, dataCom: d(dataCom), paymentDate: pay ? d(pay) : null, approvedOn: null,
  referenceLabel: null, verified: true, externalId: null, remarks: null, ...extra,
});

const db = createTestDb();
let userId: string;

beforeEach(async () => {
  await resetDatabase(db);
  userId = (await createUser(db, { email: "i@teste.dev", name: "I", password: "SenhaForte123" })).id;
});
afterAll(async () => db.$disconnect());

async function seed() {
  const mxrf = await createFund(db, userId, { ticker: "MXRF11" }, { initialBalance: { quantity: "31", averagePrice: "8.44" }, quote: { price: "8.52" } });
  const knri = await createFund(db, userId, { ticker: "KNRI11" });
  return { mxrf, knri };
}

describe("cotações automáticas", () => {
  it("consulta e grava a cotação identificada como automática; vira a atual", async () => {
    await seed();
    const provider = fakePriceProvider(async (t) => quote(t, t === "MXRF11" ? "8.56" : "150.10", "2030-01-02T20:00:00Z"));
    const r = await refreshQuotes(db, userId, { provider }, { trigger: "manual" });
    expect(r).toMatchObject({ updated: 2, failed: 0 });
    const fund = await getFundByTicker(db, userId, "MXRF11", { now: new Date("2030-01-02T21:00:00Z") });
    expect(fund?.quote).toMatchObject({ price: "8.56", source: "BRAPI", previousClose: "8.6", changePercent: "-0.47", stale: false });
    expect(fund?.metrics.currentValue?.toFixed(2)).toBe("265.36"); // 31 × 8,56
    const run = await db.syncRun.findFirstOrThrow({ where: { kind: "QUOTES" } });
    expect(run).toMatchObject({ status: "SUCCESS", itemsOk: 2, trigger: "manual" });
  });

  it("falha na API preserva a última cotação válida (nada é zerado ou apagado)", async () => {
    await seed();
    const before = await getFundByTicker(db, userId, "MXRF11");
    const countBefore = await db.priceQuote.count();
    const provider = fakePriceProvider(async () => { throw new ProviderError("UNAVAILABLE", "brapi"); });
    const r = await refreshQuotes(db, userId, { provider }, { trigger: "auto" });
    expect(r).toMatchObject({ updated: 0, failed: 2 });
    expect(await db.priceQuote.count()).toBe(countBefore);
    const after = await getFundByTicker(db, userId, "MXRF11");
    expect(after?.quote?.price).toBe(before?.quote?.price);
    expect(after?.quote?.source).toBe("MANUAL");
    const run = await db.syncRun.findFirstOrThrow({ where: { kind: "QUOTES" } });
    expect(run.status).toBe("FAILED");
    expect(JSON.stringify(run.details)).toContain("indisponível");
  });

  it("falha parcial: um fundo atualiza, outro mantém a anterior", async () => {
    await seed();
    const provider = fakePriceProvider(async (t) => {
      if (t === "KNRI11") throw new ProviderError("PLAN_RESTRICTED", "brapi");
      return quote(t, "8.56", "2030-01-02T20:00:00Z");
    });
    const r = await refreshQuotes(db, userId, { provider }, { trigger: "manual" });
    expect(r).toMatchObject({ updated: 1, failed: 1 });
    expect((await db.syncRun.findFirstOrThrow()).status).toBe("PARTIAL");
  });

  it("cache evita nova consulta e a mesma leitura não é gravada duas vezes", async () => {
    await seed();
    const provider = fakePriceProvider(async (t) => quote(t, "8.56", "2030-01-02T20:00:00Z"));
    const cache = new TtlCache<QuoteData>();
    await refreshQuotes(db, userId, { provider, cache, cacheTtlMs: 60_000 }, { trigger: "manual" });
    const second = await refreshQuotes(db, userId, { provider, cache, cacheTtlMs: 60_000 }, { trigger: "manual" });
    expect(provider.calls).toBe(2); // 2 fundos na 1ª rodada; 2ª veio do cache
    expect(second).toMatchObject({ updated: 0, unchanged: 2 });
    expect(second.items[0].message).toContain("(cache)");
    // Sem cache: mesma leitura → sem duplicar (índice único)
    await refreshQuotes(db, userId, { provider }, { trigger: "manual" });
    expect(await db.priceQuote.count({ where: { source: "BRAPI" } })).toBe(2);
  });

  it("identifica cotação desatualizada e fechamento diário", async () => {
    await seed();
    const provider = fakePriceProvider(async (t) => quote(t, "8.50", "2030-01-02T21:00:00Z", "DAILY_CLOSE"));
    await refreshQuotes(db, userId, { provider }, { trigger: "manual" });
    const fresh = await getFundByTicker(db, userId, "MXRF11", { now: new Date("2030-01-03T12:00:00Z") });
    expect(fresh?.quote).toMatchObject({ source: "BRAPI_DAILY_CLOSE", stale: false });
    const old = await getFundByTicker(db, userId, "MXRF11", { now: new Date("2030-01-08T12:00:00Z"), staleAfterBusinessHours: 24 });
    expect(old?.quote?.stale).toBe(true);
  });

  it("cotação manual mais recente prevalece sobre automática mais antiga", async () => {
    await seed();
    await refreshQuotes(db, userId, { provider: fakePriceProvider(async (t) => quote(t, "8.40", "2026-01-02T20:00:00Z")) }, { trigger: "manual" });
    await addManualQuote(db, userId, (await getFundByTicker(db, userId, "MXRF11"))!.fundId, { price: "8.70" });
    expect((await getFundByTicker(db, userId, "MXRF11"))?.quote).toMatchObject({ price: "8.7", source: "MANUAL" });
  });
});

describe("importação de proventos", () => {
  it("importa, evita duplicidade em reimportação e entre fontes, e registra divergências", async () => {
    await seed();
    const data = { MXRF11: [div("MXRF11", "2026-10-30", "2026-11-16", "0.095", { referenceLabel: "Outubro-2026" }), div("MXRF11", "2026-09-30", "2026-10-15", "0.10", { referenceLabel: "Setembro-2026" })] };
    const [first] = await importDividends(db, userId, [fakeDividendProvider(data)], { trigger: "manual", todayIso: "2026-11-20" });
    expect(first).toMatchObject({ created: 2, duplicates: 0 });

    const [again] = await importDividends(db, userId, [fakeDividendProvider(data)], { trigger: "manual", todayIso: "2026-11-20" });
    expect(again).toMatchObject({ created: 0, duplicates: 2 });

    // Outra fonte (oficial) com o mesmo evento → duplicado; com valor diferente → divergência, mantém o existente
    const official = fakeDividendProvider(
      { MXRF11: [div("MXRF11", "2026-10-30", "2026-11-16", "0.095"), div("MXRF11", "2026-09-30", "2026-10-15", "0.11")] },
      { id: "B3_FUNDOSNET" },
    );
    const [third] = await importDividends(db, userId, [official], { trigger: "manual", todayIso: "2026-11-20" });
    expect(third).toMatchObject({ created: 0, duplicates: 1, conflicts: 1 });
    expect(third.items.find((i) => i.ticker === "MXRF11")?.message).toContain("valor divergente");

    const events = await listDividendEvents(db, userId, { todayIso: "2026-11-20" });
    expect(events).toHaveLength(2);
    expect(events.map((e) => [e.competence, e.ratePerShare, e.source])).toEqual([
      ["2026-10", "0.095", "BRAPI"],
      ["2026-09", "0.1", "BRAPI"],
    ]);
  });

  it("data de pagamento divulgada depois substitui o registro anterior de forma rastreável", async () => {
    await seed();
    await importDividends(db, userId, [fakeDividendProvider({ MXRF11: [div("MXRF11", "2026-11-28", null, "0.10")] })], { trigger: "manual", todayIso: "2026-11-20" });
    await importDividends(db, userId, [fakeDividendProvider({ MXRF11: [div("MXRF11", "2026-11-28", "2026-12-15", "0.10")] })], { trigger: "manual", todayIso: "2026-11-20" });
    const all = await listDividendEvents(db, userId, { includeVoided: true });
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.voidedAt)?.voidReason).toContain("divulgou a data de pagamento");
    expect(all.filter((e) => !e.voidedAt)[0].paymentDate?.toISOString()).toBe("2026-12-15T00:00:00.000Z");
  });

  it("falha do provedor não apaga proventos já importados; fonte que exige CNPJ é ignorada sem ele", async () => {
    await seed();
    await importDividends(db, userId, [fakeDividendProvider({ MXRF11: [div("MXRF11", "2026-10-30", "2026-11-16", "0.095")] })], { trigger: "manual", todayIso: "2026-11-20" });
    const [failed] = await importDividends(db, userId, [fakeDividendProvider({ MXRF11: new ProviderError("UNAVAILABLE", "brapi") })], { trigger: "auto", todayIso: "2026-11-20" });
    expect(failed.failedFunds).toBe(1);
    expect(await db.dividendEvent.count()).toBe(1);

    const [fnet] = await importDividends(db, userId, [fakeDividendProvider({}, { id: "B3_FUNDOSNET", requiresCnpj: true })], { trigger: "manual" });
    expect(fnet.items.every((i) => i.message.includes("CNPJ"))).toBe(true);
    const fnetRun = await db.syncRun.findFirstOrThrow({ where: { provider: "B3_FUNDOSNET (simulado)" } });
    expect(fnetRun.status).toBe("SKIPPED");
  });
});

describe("cadastro manual, recebimentos e quantidade elegível", () => {
  it("cadastro manual com prevenção de duplicidade", async () => {
    const { knri } = await seed();
    const input = { fundId: knri.id, kind: "OFFICIAL" as const, type: "INCOME" as const, ratePerShare: "1,05", dataCom: "2026-10-30", paymentDate: "2026-11-14", competence: "2026-10" };
    await registerDividendEvent(db, userId, input);
    await expect(registerDividendEvent(db, userId, input)).rejects.toThrow(/Duplicidade evitada/);
    await expect(registerDividendEvent(db, userId, { ...input, dataCom: "2026-11-20", paymentDate: "2026-11-10" })).rejects.toThrow();
  });

  it("quantidade elegível vem do histórico na data-com (não da posição atual)", async () => {
    const { knri } = await seed();
    await registerTrade(db, userId, knri.id, { type: "BUY", tradeDate: "2026-09-10", quantity: "10", unitPrice: "150", fees: "0" });
    await registerTrade(db, userId, knri.id, { type: "BUY", tradeDate: "2026-10-30", quantity: "5", unitPrice: "150", fees: "0" });
    await registerTrade(db, userId, knri.id, { type: "SELL", tradeDate: "2026-11-03", quantity: "12", unitPrice: "155", fees: "0" });
    const sep = await registerDividendEvent(db, userId, { fundId: knri.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "1.00", dataCom: "2026-09-30", paymentDate: "2026-10-14" });
    const oct = await registerDividendEvent(db, userId, { fundId: knri.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "1.10", dataCom: "2026-10-30", paymentDate: "2026-11-13" });

    const r1 = await confirmReceipt(db, userId, sep.id, {}, "2026-11-20");
    // Set: 10 cotas × 1,00 = 10,00
    expect(r1).toMatchObject({ quantitySource: "LEDGER" });
    expect(r1.eligibleQuantity.toString()).toBe("10");
    expect(r1.totalAmount.toString()).toBe("10");
    // Out: 15 cotas (compra na data-com conta) × 1,10 = 16,50 — mesmo com 3 cotas hoje
    const r2 = await confirmReceipt(db, userId, oct.id, {}, "2026-11-20");
    expect(r2.eligibleQuantity.toString()).toBe("15");
    expect(r2.totalAmount.toString()).toBe("16.5");

    // Pagamento duplicado é barrado
    await expect(confirmReceipt(db, userId, oct.id, {}, "2026-11-20")).rejects.toThrow(/duplicado/);
  });

  it("saldo inicial registrado depois da data-com: exige quantidade informada", async () => {
    const { mxrf } = await seed(); // saldo inicial registrado "hoje" (data real do teste)
    const past = await registerDividendEvent(db, userId, { fundId: mxrf.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "0.095", dataCom: "2020-10-30", paymentDate: "2020-11-16" });
    await expect(confirmReceipt(db, userId, past.id, {})).rejects.toThrow(/desconhecida/);
    const r = await confirmReceipt(db, userId, past.id, { quantity: "31" });
    // 31 × 0,095 = 2,945 → 2,95
    expect(r).toMatchObject({ quantitySource: "MANUAL" });
    expect(r.totalAmount.toString()).toBe("2.95");
  });

  it("previsão não é recebível; pagamento futuro também não", async () => {
    const { knri } = await seed();
    await registerTrade(db, userId, knri.id, { type: "BUY", tradeDate: "2026-09-10", quantity: "10", unitPrice: "150", fees: "0" });
    const forecast = await registerDividendEvent(db, userId, { fundId: knri.id, kind: "FORECAST", type: "INCOME", ratePerShare: "1.00", dataCom: "2026-11-30", paymentDate: "2026-12-14" });
    await expect(confirmReceipt(db, userId, forecast.id, {}, "2026-12-20")).rejects.toThrow(/Previsões/);
    const future = await registerDividendEvent(db, userId, { fundId: knri.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "1.00", dataCom: "2026-11-30", paymentDate: "2026-12-14" });
    await expect(confirmReceipt(db, userId, future.id, {}, "2026-11-20")).rejects.toThrow(/ainda não ocorreu/);
  });

  it("anular: exige motivo; provento com recebimento só após anular o recebimento", async () => {
    const { knri } = await seed();
    await registerTrade(db, userId, knri.id, { type: "BUY", tradeDate: "2026-09-10", quantity: "10", unitPrice: "150", fees: "0" });
    const ev = await registerDividendEvent(db, userId, { fundId: knri.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "1.00", dataCom: "2026-09-30", paymentDate: "2026-10-14" });
    const rec = await confirmReceipt(db, userId, ev.id, {}, "2026-11-20");
    await expect(voidDividendEvent(db, userId, ev.id, "Lançado errado")).rejects.toThrow(/Anule o recebimento/);
    await expect(voidReceipt(db, userId, rec.id, "x")).rejects.toThrow();
    await voidReceipt(db, userId, rec.id, "Valor conferido no extrato");
    await voidDividendEvent(db, userId, ev.id, "Lançado em duplicidade");
    await expect(db.dividendEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/não podem ser excluídos/);
    await expect(db.dividendReceipt.update({ where: { id: rec.id }, data: { totalAmount: "99" } })).rejects.toThrow(/imutáveis/);
  });
});

describe("visão consolidada e próximos pagamentos", () => {
  it("renda, pendências, próximos pagamentos e 'Aguardando divulgação'", async () => {
    const { mxrf, knri } = await seed();
    await registerTrade(db, userId, knri.id, { type: "BUY", tradeDate: "2026-01-05", quantity: "10", unitPrice: "150", fees: "0" });
    for (const [com, pay] of [["2026-09-30", "2026-10-14"], ["2026-10-30", "2026-11-13"]]) {
      await registerDividendEvent(db, userId, { fundId: knri.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "1.00", dataCom: com, paymentDate: pay });
    }
    await registerDividendEvent(db, userId, { fundId: knri.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "1.05", dataCom: "2026-11-28", paymentDate: "2026-12-14", competence: "2026-11" });
    await registerDividendEvent(db, userId, { fundId: mxrf.id, kind: "FORECAST", type: "INCOME", ratePerShare: "0.10", dataCom: "2026-11-28", paymentDate: "2026-12-15", competence: "2026-11" });

    let o = await getDividendsOverview(db, userId, { todayIso: "2026-11-20" });
    expect(o.pending).toHaveLength(2);
    const knriUp = o.upcoming.find((u) => u.ticker === "KNRI11")!;
    expect(knriUp.announced).toHaveLength(1);
    expect(knriUp.announced[0].expectedAmount?.toFixed(2)).toBe("10.50"); // 10 × 1,05
    const mxrfUp = o.upcoming.find((u) => u.ticker === "MXRF11")!;
    expect(mxrfUp.announced).toHaveLength(0); // UI: "Aguardando divulgação."
    expect(mxrfUp.forecasts).toHaveLength(1);

    const bulk = await confirmPendingReceipts(db, userId, "2026-11-20");
    expect(bulk).toEqual({ created: 2, unknown: 0 });
    o = await getDividendsOverview(db, userId, { todayIso: "2026-11-20" });
    expect(o.pending).toHaveLength(0);
    expect(o.income.totalReceived.toFixed(2)).toBe("20.00");
    expect(o.income.byFund[0]).toMatchObject({ ticker: "KNRI11" });
    expect(o.income.monthly.map((m) => [m.month, m.total.toFixed(2)])).toEqual([["2026-10", "10.00"], ["2026-11", "10.00"]]);
  });

  it("histórico persiste após nova conexão (reinício)", async () => {
    const { knri } = await seed();
    await registerTrade(db, userId, knri.id, { type: "BUY", tradeDate: "2026-01-05", quantity: "10", unitPrice: "150", fees: "0" });
    const ev = await registerDividendEvent(db, userId, { fundId: knri.id, kind: "OFFICIAL", type: "INCOME", ratePerShare: "1.00", dataCom: "2026-09-30", paymentDate: "2026-10-14" });
    await confirmReceipt(db, userId, ev.id, {}, "2026-11-20");
    const fresh = createPrismaClient(process.env.DATABASE_URL!);
    try {
      const o = await getDividendsOverview(fresh, userId, { todayIso: "2026-11-20" });
      expect(o.receipts).toHaveLength(1);
      expect(o.income.totalReceived.toFixed(2)).toBe("10.00");
    } finally {
      await fresh.$disconnect();
    }
  });
});

describe("atualização automática configurável", () => {
  it("roda quando o intervalo venceu e respeita a configuração", async () => {
    await seed();
    const price = fakePriceProvider(async (t) => quote(t, "8.56", "2030-01-02T20:00:00Z"));
    const integrations = {
      enabled: true, price, dividends: [fakeDividendProvider({})], assetInfo: null, indexRates: null,
      quoteCache: new TtlCache<QuoteData>(), quoteCacheTtlMs: 0, staleAfterBusinessHours: 24,
      status: { brapiApiKey: false, brapiDailyCloseFallback: true, fundosNetEnabled: false, cronConfigured: false },
    } satisfies Integrations;

    await maybeAutoRefresh(db, userId, integrations);
    expect(price.calls).toBe(2);
    await maybeAutoRefresh(db, userId, integrations); // dentro do intervalo: não repete
    expect(price.calls).toBe(2);
    await maybeAutoRefresh(db, userId, integrations, new Date(Date.now() + 31 * 60_000));
    expect(price.calls).toBe(4);

    await updateUserSettings(db, userId, { autoUpdateEnabled: false, quoteRefreshMinutes: 30, dividendRefreshHours: 12 });
    await maybeAutoRefresh(db, userId, integrations, new Date(Date.now() + 120 * 60_000));
    expect(price.calls).toBe(4);
    const runs = await db.syncRun.findMany({ where: { trigger: "auto" } });
    expect(runs.length).toBeGreaterThanOrEqual(3);
    vi.restoreAllMocks();
  });
});
