import type { Database } from "@/server/db/factory";
import { Prisma } from "@/generated/prisma/client";
import { parseIsoDate, toIsoDate, todayIsoDate } from "@/domain/dates";
import { minusMonthsIso, parseCompetence } from "@/domain/dividends";
import { toDecimal } from "@/domain/money";
import { isProviderError } from "@/server/integrations/errors";
import type { DividendData, DividendProvider } from "@/server/integrations/types";
import { recordAudit } from "../audit";
import { recordSyncRun, type SyncItemResult, type SyncTrigger } from "../market/sync-log";

/**
 * Importação automática de proventos OFICIAIS a partir de DividendProviders.
 *
 * Prevenção de duplicidade (mesmo provento vindo de mais de uma fonte ou de
 * importações repetidas): chave = fundo + tipo + data-com + data de pagamento.
 * - Mesmo valor → ignorado (duplicado).
 * - Valor diferente → DIVERGÊNCIA: mantém o existente e registra no log
 *   (nada é sobrescrito silenciosamente).
 * - Existente sem data de pagamento e a fonte traz a data → o anterior é
 *   anulado com motivo e o novo é registrado (rastreável).
 * O índice único parcial no banco garante a regra mesmo em concorrência.
 */

export type ImportOutcome = "created" | "duplicate" | "conflict" | "replaced";

const SOURCE_BY_PROVIDER = { BRAPI: "BRAPI", B3_FUNDOSNET: "B3_FUNDOSNET" } as const;

export async function upsertImportedEvent(
  db: Database,
  userId: string,
  fundId: string,
  data: DividendData,
  providerId: keyof typeof SOURCE_BY_PROVIDER,
): Promise<{ outcome: ImportOutcome; detail?: string }> {
  return db.$transaction(async (tx) => {
    // Serializa importações concorrentes do mesmo fundo.
    await tx.$queryRaw`SELECT id FROM funds WHERE id = ${fundId} FOR UPDATE`;
    const candidates = await tx.dividendEvent.findMany({
      where: { fundId, kind: "OFFICIAL", type: data.type, dataCom: data.dataCom, voidedAt: null },
    });
    const newPay = data.paymentDate ? toIsoDate(data.paymentDate) : null;
    const rate = toDecimal(data.ratePerShare);

    // Fonte sem data de pagamento, mas já existe registro com data: o existente é mais completo.
    if (newPay === null) {
      const dated = candidates.find((c) => c.paymentDate);
      if (dated) {
        return toDecimal(dated.ratePerShare.toString()).equals(rate)
          ? { outcome: "duplicate" }
          : { outcome: "conflict", detail: `valor divergente para data-com ${toIsoDate(data.dataCom)}: registrado ${dated.ratePerShare.toString()}, fonte informa ${rate.toFixed()}` };
      }
    }

    for (const c of candidates) {
      const pay = c.paymentDate ? toIsoDate(c.paymentDate) : null;
      if (pay === newPay) {
        if (toDecimal(c.ratePerShare.toString()).equals(rate)) return { outcome: "duplicate" };
        return {
          outcome: "conflict",
          detail: `valor divergente para data-com ${toIsoDate(data.dataCom)}: registrado ${c.ratePerShare.toString()} (${c.source}), fonte informa ${rate.toFixed()}`,
        };
      }
      if (pay !== null && newPay !== null) {
        return {
          outcome: "conflict",
          detail: `data de pagamento divergente para data-com ${toIsoDate(data.dataCom)}: registrado ${pay}, fonte informa ${newPay}`,
        };
      }
    }

    let outcome: ImportOutcome = "created";
    const withoutPayment = candidates.find((c) => !c.paymentDate);
    if (withoutPayment && newPay) {
      await tx.dividendEvent.update({
        where: { id: withoutPayment.id },
        data: { voidedAt: new Date(), voidReason: `Substituído: ${providerId} divulgou a data de pagamento (${newPay}).` },
      });
      outcome = "replaced";
    }

    const event = await tx.dividendEvent.create({
      data: {
        userId,
        fundId,
        kind: "OFFICIAL",
        type: data.type,
        source: SOURCE_BY_PROVIDER[providerId],
        ratePerShare: rate.toFixed(),
        dataCom: data.dataCom,
        paymentDate: data.paymentDate,
        approvedOn: data.approvedOn,
        competence: parseCompetence(data.referenceLabel),
        referenceLabel: data.referenceLabel,
        verified: data.verified,
        externalId: data.externalId,
        notes: data.remarks,
      },
    });
    await recordAudit(tx, {
      userId,
      entityType: "dividend",
      entityId: event.id,
      action: "import",
      data: { source: providerId, externalId: data.externalId, ratePerShare: rate.toFixed(), dataCom: toIsoDate(data.dataCom), paymentDate: newPay },
    });
    return { outcome };
  });
}

export interface DividendImportResult {
  provider: string;
  created: number;
  duplicates: number;
  conflicts: number;
  failedFunds: number;
  items: SyncItemResult[];
}

export async function importDividends(
  db: Database,
  userId: string,
  providers: DividendProvider[],
  options: { trigger: SyncTrigger; fundIds?: string[]; todayIso?: string; monthsBack?: number } = { trigger: "manual" },
): Promise<DividendImportResult[]> {
  const todayIso = options.todayIso ?? todayIsoDate();
  const from = parseIsoDate(minusMonthsIso(todayIso, options.monthsBack ?? 13))!;
  const funds = await db.fund.findMany({
    where: { userId, archivedAt: null, ...(options.fundIds ? { id: { in: options.fundIds } } : {}) },
    select: { id: true, ticker: true, cnpj: true },
    orderBy: { ticker: "asc" },
  });

  const results: DividendImportResult[] = [];
  for (const provider of providers) {
    const startedAt = new Date();
    const items: SyncItemResult[] = [];
    const totals = { created: 0, duplicates: 0, conflicts: 0, failedFunds: 0 };

    for (const fund of funds) {
      if (provider.requiresCnpj && !fund.cnpj) {
        items.push({ ticker: fund.ticker, ok: true, skipped: true, message: "Ignorado: CNPJ do fundo não cadastrado." });
        continue;
      }
      try {
        const known = await db.dividendEvent.findMany({
          where: { fundId: fund.id, externalId: { not: null } },
          select: { externalId: true },
        });
        const data = await provider.getDividends({
          ticker: fund.ticker,
          cnpj: fund.cnpj,
          from,
          knownExternalIds: new Set(known.map((k) => k.externalId!)),
        });
        const counts = { created: 0, duplicate: 0, conflict: 0, replaced: 0 };
        const conflicts: string[] = [];
        for (const item of data) {
          try {
            const r = await upsertImportedEvent(db, userId, fund.id, item, provider.id);
            counts[r.outcome] += 1;
            if (r.detail) conflicts.push(r.detail);
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
              counts.duplicate += 1; // corrida com outra importação: o índice único barrou
            } else {
              throw error;
            }
          }
        }
        totals.created += counts.created + counts.replaced;
        totals.duplicates += counts.duplicate;
        totals.conflicts += counts.conflict;
        items.push({
          ticker: fund.ticker,
          ok: true,
          message:
            `${data.length} recebido(s): ${counts.created} novo(s), ${counts.replaced} atualizado(s), ${counts.duplicate} já existente(s), ${counts.conflict} divergência(s).` +
            (conflicts.length ? ` ${conflicts.join("; ")}` : ""),
        });
      } catch (error) {
        totals.failedFunds += 1;
        items.push({ ticker: fund.ticker, ok: false, message: isProviderError(error) ? error.message : "Falha inesperada." });
        if (!isProviderError(error)) console.error("[dividends] erro inesperado", error);
      }
    }

    await recordSyncRun(db, {
      userId,
      kind: "DIVIDENDS",
      provider: provider.name,
      trigger: options.trigger,
      startedAt,
      items,
      skipped: funds.length === 0,
      message: funds.length === 0 ? "Nenhum fundo ativo." : undefined,
    });
    results.push({ provider: provider.name, ...totals, items });
  }
  return results;
}
