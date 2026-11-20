import type { Database } from "@/server/db/factory";
import type { Prisma } from "@/generated/prisma/client";

export type SyncKind = "QUOTES" | "DIVIDENDS" | "ASSET_INFO" | "PRICE_HISTORY";
export type SyncTrigger = "manual" | "auto" | "cron";

export interface SyncItemResult {
  ticker: string;
  ok: boolean;
  message: string;
  /** Item não processado por falta de pré-requisito (ex.: CNPJ). */
  skipped?: boolean;
}

/** Grava o resultado de uma atualização (última atualização, falhas por ativo). */
export async function recordSyncRun(
  db: Database,
  run: {
    userId: string;
    kind: SyncKind;
    provider: string;
    trigger: SyncTrigger;
    startedAt: Date;
    items: SyncItemResult[];
    message?: string;
    skipped?: boolean;
  },
) {
  const processed = run.items.filter((i) => !i.skipped);
  const ok = processed.filter((i) => i.ok).length;
  const failed = processed.length - ok;
  const status = run.skipped || processed.length === 0
    ? "SKIPPED"
    : failed === 0
      ? "SUCCESS"
      : ok === 0
        ? "FAILED"
        : "PARTIAL";
  return db.syncRun.create({
    data: {
      userId: run.userId,
      kind: run.kind,
      provider: run.provider,
      trigger: run.trigger,
      status,
      message: run.message ?? null,
      itemsOk: ok,
      itemsFailed: failed,
      details: run.items as unknown as Prisma.InputJsonValue,
      startedAt: run.startedAt,
      finishedAt: new Date(),
    },
  });
}

export async function lastSyncRuns(db: Database, userId: string) {
  const kinds: SyncKind[] = ["QUOTES", "DIVIDENDS", "PRICE_HISTORY", "ASSET_INFO"];
  const entries = await Promise.all(
    kinds.map(async (kind) => {
      const [last, lastSuccess] = await Promise.all([
        db.syncRun.findFirst({ where: { userId, kind }, orderBy: { startedAt: "desc" } }),
        db.syncRun.findFirst({
          where: { userId, kind, status: { in: ["SUCCESS", "PARTIAL"] } },
          orderBy: { startedAt: "desc" },
        }),
      ]);
      return [kind, { last, lastSuccess }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<
    SyncKind,
    { last: Awaited<ReturnType<Database["syncRun"]["findFirst"]>>; lastSuccess: Awaited<ReturnType<Database["syncRun"]["findFirst"]>> }
  >;
}

export async function recentSyncRuns(db: Database, userId: string, take = 20) {
  return db.syncRun.findMany({ where: { userId }, orderBy: { startedAt: "desc" }, take });
}
