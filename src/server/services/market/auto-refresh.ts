import type { Database } from "@/server/db/factory";
import type { Integrations } from "@/server/integrations/registry";
import { importDividends } from "../dividends/import-service";
import { refreshQuotes } from "./quote-service";
import type { SyncTrigger } from "./sync-log";

/**
 * Atualização automática configurável (por usuário, em user_settings):
 * - executada em segundo plano após o carregamento das páginas privadas
 *   (after() do Next) quando o intervalo configurado venceu;
 * - ou por um agendador externo via /api/cron/refresh (CRON_SECRET).
 * O intervalo é contado a partir da última TENTATIVA (inclusive falhas), para
 * não insistir em um provedor indisponível a cada página aberta.
 */

export const SETTINGS_LIMITS = {
  quoteRefreshMinutes: { min: 15, max: 1440 },
  dividendRefreshHours: { min: 1, max: 168 },
} as const;

export async function getUserSettings(db: Database, userId: string) {
  return db.userSettings.upsert({ where: { userId }, create: { userId }, update: {} });
}

export async function updateUserSettings(
  db: Database,
  userId: string,
  input: { autoUpdateEnabled: boolean; quoteRefreshMinutes: number; dividendRefreshHours: number },
) {
  const clamp = (v: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, Math.round(v)));
  const data = {
    autoUpdateEnabled: input.autoUpdateEnabled,
    quoteRefreshMinutes: clamp(input.quoteRefreshMinutes, SETTINGS_LIMITS.quoteRefreshMinutes),
    dividendRefreshHours: clamp(input.dividendRefreshHours, SETTINGS_LIMITS.dividendRefreshHours),
  };
  return db.userSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

const inflight = new Set<string>();

async function lastAttempt(db: Database, userId: string, kind: "QUOTES" | "DIVIDENDS") {
  const run = await db.syncRun.findFirst({ where: { userId, kind }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
  return run?.startedAt ?? null;
}

export async function runRefresh(
  db: Database,
  userId: string,
  integrations: Integrations,
  what: { quotes: boolean; dividends: boolean },
  trigger: SyncTrigger,
) {
  const key = `${userId}:${what.quotes ? "q" : ""}${what.dividends ? "d" : ""}`;
  if (inflight.has(key)) return { skipped: true as const };
  inflight.add(key);
  try {
    const quotes =
      what.quotes && integrations.price
        ? await refreshQuotes(db, userId, { provider: integrations.price, cache: integrations.quoteCache, cacheTtlMs: integrations.quoteCacheTtlMs }, { trigger })
        : null;
    const dividends =
      what.dividends && integrations.dividends.length
        ? await importDividends(db, userId, integrations.dividends, { trigger })
        : null;
    return { skipped: false as const, quotes, dividends };
  } finally {
    inflight.delete(key);
  }
}

/** Decide se a atualização automática venceu e a executa. Nunca lança. */
export async function maybeAutoRefresh(db: Database, userId: string, integrations: Integrations, now = new Date()) {
  try {
    if (!integrations.enabled) return;
    const settings = await getUserSettings(db, userId);
    if (!settings.autoUpdateEnabled) return;
    const [q, d] = await Promise.all([lastAttempt(db, userId, "QUOTES"), lastAttempt(db, userId, "DIVIDENDS")]);
    const quotesDue = !q || now.getTime() - q.getTime() >= settings.quoteRefreshMinutes * 60_000;
    const dividendsDue = !d || now.getTime() - d.getTime() >= settings.dividendRefreshHours * 3_600_000;
    if (!quotesDue && !dividendsDue) return;
    await runRefresh(db, userId, integrations, { quotes: quotesDue, dividends: dividendsDue }, "auto");
  } catch (error) {
    console.error("[auto-refresh] falha", error);
  }
}
