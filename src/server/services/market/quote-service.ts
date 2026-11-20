import type { Database } from "@/server/db/factory";
import { isProviderError } from "@/server/integrations/errors";
import type { TtlCache } from "@/server/integrations/cache";
import type { PriceProvider, QuoteData } from "@/server/integrations/types";
import { recordSyncRun, type SyncItemResult, type SyncTrigger } from "./sync-log";

/**
 * Atualização de cotações a partir de um PriceProvider.
 *
 * Garantias:
 * - Só grava cotações válidas (preço > 0 e horário informado). Falhas NUNCA
 *   apagam nem sobrescrevem a última cotação válida — simplesmente não gravam.
 * - Cada leitura vira uma nova linha em price_quotes com a origem (BRAPI ou
 *   BRAPI_DAILY_CLOSE); a mesma leitura (mesmo horário de mercado) não é
 *   duplicada.
 * - Respostas ficam em cache em memória pelo TTL configurado.
 */

export interface QuoteRefreshDeps {
  provider: PriceProvider;
  cache?: TtlCache<QuoteData>;
  cacheTtlMs?: number;
}

export interface QuoteRefreshResult {
  updated: number;
  unchanged: number;
  failed: number;
  items: SyncItemResult[];
}

export async function refreshQuotes(
  db: Database,
  userId: string,
  deps: QuoteRefreshDeps,
  options: { trigger: SyncTrigger; fundIds?: string[] } = { trigger: "manual" },
): Promise<QuoteRefreshResult> {
  const startedAt = new Date();
  const funds = await db.fund.findMany({
    where: {
      userId,
      archivedAt: null,
      ...(options.fundIds ? { id: { in: options.fundIds } } : {}),
    },
    select: { id: true, ticker: true },
    orderBy: { ticker: "asc" },
  });

  const items: SyncItemResult[] = [];
  let updated = 0;
  let unchanged = 0;

  for (const fund of funds) {
    try {
      const load = () => deps.provider.getQuote(fund.ticker);
      const { value: quote, cached } = deps.cache
        ? await deps.cache.getOrLoad(`quote:${deps.provider.id}:${fund.ticker}`, deps.cacheTtlMs ?? 0, load)
        : { value: await load(), cached: false };

      const source = quote.kind === "DAILY_CLOSE" ? "BRAPI_DAILY_CLOSE" : "BRAPI";
      const created = await db.priceQuote.createMany({
        data: [
          {
            fundId: fund.id,
            price: quote.price,
            source,
            marketTime: quote.marketTime,
            previousClose: quote.previousClose,
            change: quote.change,
            changePercent: quote.changePercent,
            note: quote.kind === "DAILY_CLOSE" ? "Último fechamento do histórico diário" : null,
          },
        ],
        skipDuplicates: true, // mesma leitura (fundo, fonte, horário) não duplica
      });
      if (created.count > 0) updated += 1;
      else unchanged += 1;
      items.push({
        ticker: fund.ticker,
        ok: true,
        message: `${created.count > 0 ? "Atualizada" : "Sem mudança"}${cached ? " (cache)" : ""}: R$ ${quote.price} em ${quote.marketTime.toISOString()}`,
      });
    } catch (error) {
      items.push({
        ticker: fund.ticker,
        ok: false,
        message: isProviderError(error) ? error.message : "Falha inesperada.",
      });
      if (!isProviderError(error)) console.error("[quotes] erro inesperado", error);
    }
  }

  await recordSyncRun(db, {
    userId,
    kind: "QUOTES",
    provider: deps.provider.name,
    trigger: options.trigger,
    startedAt,
    items,
    skipped: funds.length === 0,
    message: funds.length === 0 ? "Nenhum fundo ativo." : undefined,
  });

  return { updated, unchanged, failed: items.filter((i) => !i.ok).length, items };
}

/** Importa o histórico diário de preços de um fundo (se o provedor/plano permitir). */
export async function refreshPriceHistory(
  db: Database,
  userId: string,
  provider: PriceProvider,
  options: { trigger: SyncTrigger; days?: number; now?: Date } = { trigger: "manual" },
) {
  const startedAt = new Date();
  const items: SyncItemResult[] = [];
  if (!provider.getDailyHistory) {
    await recordSyncRun(db, { userId, kind: "PRICE_HISTORY", provider: provider.name, trigger: options.trigger, startedAt, items, skipped: true, message: "Provedor sem histórico." });
    return items;
  }
  const funds = await db.fund.findMany({ where: { userId, archivedAt: null }, select: { id: true, ticker: true } });
  const to = options.now ?? new Date();
  const from = new Date(to.getTime() - (options.days ?? 90) * 24 * 3600 * 1000);
  const source = provider.id === "BRAPI" ? "BRAPI_DAILY_CLOSE" : "MANUAL";

  for (const fund of funds) {
    try {
      const rows = await provider.getDailyHistory(fund.ticker, from, to);
      const created = await db.dailyPrice.createMany({
        data: rows.map((r) => ({ fundId: fund.id, source, ...r })),
        skipDuplicates: true,
      });
      items.push({ ticker: fund.ticker, ok: true, message: `${rows.length} dia(s) recebidos, ${created.count} novo(s).` });
    } catch (error) {
      items.push({ ticker: fund.ticker, ok: false, message: isProviderError(error) ? error.message : "Falha inesperada." });
    }
  }
  await recordSyncRun(db, { userId, kind: "PRICE_HISTORY", provider: provider.name, trigger: options.trigger, startedAt, items, skipped: funds.length === 0 });
  return items;
}

export async function listDailyPrices(db: Database, userId: string, fundId: string, take = 120) {
  const fund = await db.fund.findFirst({ where: { id: fundId, userId }, select: { id: true } });
  if (!fund) return [];
  const rows = await db.dailyPrice.findMany({
    where: { fundId },
    orderBy: { date: "desc" },
    take,
  });
  return rows.reverse().map((r) => ({ date: r.date, close: r.close.toString() }));
}
