import type { Database } from "@/server/db/factory";
import { addDays, businessDaysBetween, fromIso, toIso, type IsoDate } from "@/domain/fixed-income/calendar";
import { todayIsoDate } from "@/domain/dates";
import { isProviderError } from "@/server/integrations/errors";
import type { IndexRateProvider } from "@/server/integrations/types";

/**
 * Cache local das taxas diárias do CDI/Selic (tabela index_daily_rates).
 *
 * - Incremental: só busca o que falta antes da menor e depois da maior data já
 *   guardada, no máximo uma vez por hora (salvo `force`). Nada é apagado; taxas já gravadas não são sobrescritas.
 * - Se a API falhar, o cache continua valendo (o cálculo usa a última taxa
 *   conhecida como projeção) e o erro fica registrado em index_sync_status.
 * - Sem provedor (INTEGRATIONS_ENABLED=false) nada é buscado.
 */

export type RateIndexer = "CDI" | "SELIC";

export interface IndexSyncResult {
  indexer: RateIndexer;
  status: "SUCCESS" | "FAILED" | "SKIPPED" | "DISABLED";
  inserted: number;
  message: string | null;
  knownUntil: IsoDate | null;
}

/** Intervalo mínimo entre buscas de datas recentes (evita chamadas repetidas). */
export const INDEX_SYNC_MIN_INTERVAL_MS = 60 * 60 * 1000;

async function cachedRange(db: Database, indexer: RateIndexer) {
  const agg = await db.indexDailyRate.aggregate({
    where: { indexer },
    _min: { date: true },
    _max: { date: true },
  });
  return {
    min: agg._min.date ? toIso(agg._min.date) : null,
    max: agg._max.date ? toIso(agg._max.date) : null,
  };
}

export async function syncIndexRates(
  db: Database,
  provider: IndexRateProvider | null,
  indexer: RateIndexer,
  opts: { from: IsoDate; to?: IsoDate; now?: Date; force?: boolean },
): Promise<IndexSyncResult> {
  const now = opts.now ?? new Date();
  const to = opts.to ?? todayIsoDate(now);
  const range = await cachedRange(db, indexer);
  if (!provider) {
    return { indexer, status: "DISABLED", inserted: 0, message: "Integrações desligadas.", knownUntil: range.max };
  }

  const windows: [IsoDate, IsoDate][] = [];
  if (!range.min || !range.max) {
    if (opts.from <= to) windows.push([opts.from, to]);
  } else {
    const status = await db.indexSyncStatus.findUnique({ where: { indexer } });
    const recentlyTried =
      !opts.force &&
      status?.lastAttemptAt != null &&
      now.getTime() - status.lastAttemptAt.getTime() < INDEX_SYNC_MIN_INTERVAL_MS;
    if (!recentlyTried) {
      // Só busca antes da menor data se houver dia útil no intervalo.
      if (opts.from < range.min && businessDaysBetween(opts.from, range.min).length > 0) {
        windows.push([opts.from, addDays(range.min, -1)]);
      }
      if (range.max < to) windows.push([addDays(range.max, 1), to]);
    }
  }
  if (windows.length === 0) {
    return { indexer, status: "SKIPPED", inserted: 0, message: null, knownUntil: range.max };
  }

  let inserted = 0;
  try {
    for (const [from, until] of windows) {
      const rates = await provider.getDailyRates(indexer, from, until);
      if (rates.length === 0) continue;
      const result = await db.indexDailyRate.createMany({
        data: rates.map((r) => ({ indexer, date: fromIso(r.date), dailyRatePercent: r.dailyRatePercent, fetchedAt: now })),
        skipDuplicates: true,
      });
      inserted += result.count;
    }
  } catch (error) {
    const message = isProviderError(error) ? error.userMessage : "Falha inesperada ao buscar os índices.";
    await db.indexSyncStatus.upsert({
      where: { indexer },
      create: { indexer, lastAttemptAt: now, lastError: message },
      update: { lastAttemptAt: now, lastError: message },
    });
    const after = await cachedRange(db, indexer);
    return { indexer, status: "FAILED", inserted, message, knownUntil: after.max };
  }

  await db.indexSyncStatus.upsert({
    where: { indexer },
    create: { indexer, lastAttemptAt: now, lastSuccessAt: now, lastError: null },
    update: { lastAttemptAt: now, lastSuccessAt: now, lastError: null },
  });
  const after = await cachedRange(db, indexer);
  return { indexer, status: "SUCCESS", inserted, message: null, knownUntil: after.max };
}

/** Taxas guardadas no intervalo [from, to], como mapa data → % do dia (string). */
export async function loadIndexRates(
  db: Database,
  indexer: RateIndexer,
  from: IsoDate,
  to: IsoDate,
): Promise<Map<IsoDate, string>> {
  const rows = await db.indexDailyRate.findMany({
    where: { indexer, date: { gte: fromIso(from), lte: fromIso(to) } },
    orderBy: { date: "asc" },
  });
  return new Map(rows.map((r) => [toIso(r.date), r.dailyRatePercent.toString()]));
}

/** Última taxa anterior a `before` (para projetar quando o intervalo não tem taxas). */
export async function lastRateBefore(db: Database, indexer: RateIndexer, before: IsoDate) {
  const row = await db.indexDailyRate.findFirst({
    where: { indexer, date: { lt: fromIso(before) } },
    orderBy: { date: "desc" },
  });
  return row ? { date: toIso(row.date), dailyRatePercent: row.dailyRatePercent.toString() } : null;
}

export interface IndexStatusView {
  indexer: RateIndexer;
  knownFrom: IsoDate | null;
  knownUntil: IsoDate | null;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
}

/** Situação do cache por indexador (para a Central de dados). */
export async function getIndexStatus(db: Database): Promise<IndexStatusView[]> {
  const indexers: RateIndexer[] = ["CDI", "SELIC"];
  return Promise.all(
    indexers.map(async (indexer) => {
      const [range, status] = await Promise.all([
        cachedRange(db, indexer),
        db.indexSyncStatus.findUnique({ where: { indexer } }),
      ]);
      return {
        indexer,
        knownFrom: range.min,
        knownUntil: range.max,
        lastAttemptAt: status?.lastAttemptAt ?? null,
        lastSuccessAt: status?.lastSuccessAt ?? null,
        lastError: status?.lastError ?? null,
      };
    }),
  );
}
