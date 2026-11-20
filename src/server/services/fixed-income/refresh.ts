import type { Database } from "@/server/db/factory";
import type { IndexRateProvider } from "@/server/integrations/types";
import { earliestMovementByIndexer } from "./fixed-income-service";
import { syncIndexRates, type IndexSyncResult, type RateIndexer } from "./index-rate-service";

/**
 * Garante que o cache de índices cubra os movimentos do usuário antes de
 * exibir valores. Barato quando o cache está em dia (no máximo uma busca por
 * hora por indexador). Nunca lança: falhas ficam registradas no status e a
 * tela segue com o cache (projeção). Limitado por `budgetMs` para não travar
 * a página se a API estiver lenta.
 */
export async function ensureIndexRates(
  db: Database,
  provider: IndexRateProvider | null,
  userId: string,
  opts: { force?: boolean; budgetMs?: number } = {},
): Promise<IndexSyncResult[]> {
  if (!provider) return [];
  const earliest = await earliestMovementByIndexer(db, userId);
  const work = (Object.entries(earliest) as [RateIndexer, string][]).map(([indexer, from]) =>
    syncIndexRates(db, provider, indexer, { from, force: opts.force }).catch(
      (): IndexSyncResult => ({ indexer, status: "FAILED", inserted: 0, message: "Falha ao atualizar os índices.", knownUntil: null }),
    ),
  );
  if (work.length === 0) return [];
  const all = Promise.all(work);
  if (!opts.budgetMs) return all;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<IndexSyncResult[]>((resolve) => {
    timer = setTimeout(() => resolve([]), opts.budgetMs);
  });
  try {
    return await Promise.race([all, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
