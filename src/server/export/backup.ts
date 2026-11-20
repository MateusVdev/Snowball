import { createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "@/server/db/factory";
import type { Prisma } from "@/generated/prisma/client";
import { rebuildFundLedger } from "@/server/services/portfolio/ledger-sync";
import { ServiceError } from "@/server/services/errors";
import { parseSimulationConfig } from "@/validation/simulation";
import type { FixedIncomeSimulationFormInput } from "@/validation/fixed-income-simulation";
import { runFixedIncomeSimulation, simulationSummaryJson } from "@/server/services/fixed-income/simulation-service";

/**
 * Backup e restauração dos dados do usuário (JSON).
 * - NÃO inclui credenciais, sessões ou tentativas de login.
 * - Tem checksum SHA-256 do conteúdo para detectar arquivos corrompidos/alterados.
 * - Restauração apenas em conta SEM dados (fundos, proventos, simulações,
 *   metas, renda fixa): nada é apagado nem sobrescrito.
 * - Renda fixa: títulos e movimentos entram no backup. As taxas do CDI/Selic
 *   (cache público do Banco Central) não entram: são buscadas de novo.
 *   Backups antigos (sem renda fixa) continuam válidos — os campos são opcionais.
 * - Simulações de renda fixa (parâmetros) entram no backup; o resultado é
 *   recalculado na restauração. Novos IDs são gerados e as
 *   referências internas são remapeadas; o livro-razão de cada fundo é
 *   reprocessado (histórico inconsistente → nada é gravado).
 */

export const BACKUP_FORMAT = "bola-de-neve-backup";
export const BACKUP_VERSION = 1;

const toStr = (v: { toString(): string } | null) => (v === null ? null : v.toString());
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function exportBackup(db: Database, userId: string) {
  const [funds, operations, quotes, dailyPrices, events, receipts, simulations, goals, settings, audit, fiAssets, fiMovements, fiSims] = await Promise.all([
    db.fund.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.operation.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.priceQuote.findMany({ where: { fund: { userId } }, orderBy: { recordedAt: "asc" } }),
    db.dailyPrice.findMany({ where: { fund: { userId } }, orderBy: { date: "asc" } }),
    db.dividendEvent.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.dividendReceipt.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.simulation.findMany({ where: { userId }, include: { versions: { orderBy: { version: "asc" } } }, orderBy: { createdAt: "asc" } }),
    db.financialGoal.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.userSettings.findUnique({ where: { userId } }),
    db.auditEvent.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.fixedIncomeAsset.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.fixedIncomeMovement.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.fixedIncomeSimulation.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);
  const data = {
    funds: funds.map((f) => ({ id: f.id, ticker: f.ticker, name: f.name, segment: f.segment, cnpj: f.cnpj, notes: f.notes, archivedAt: iso(f.archivedAt), createdAt: iso(f.createdAt) })),
    operations: operations.map((o) => ({
      id: o.id, fundId: o.fundId, type: o.type, status: o.status, tradeDate: iso(o.tradeDate), sequence: o.sequence,
      quantity: toStr(o.quantity), unitPrice: toStr(o.unitPrice), fees: toStr(o.fees), grossAmount: toStr(o.grossAmount), netAmount: toStr(o.netAmount),
      notes: o.notes, correctsId: o.correctsId, voidedAt: iso(o.voidedAt), voidReason: o.voidReason, createdAt: iso(o.createdAt),
    })),
    quotes: quotes.map((q) => ({ fundId: q.fundId, price: toStr(q.price), source: q.source, referenceDate: iso(q.referenceDate), note: q.note, marketTime: iso(q.marketTime), previousClose: toStr(q.previousClose), change: toStr(q.change), changePercent: toStr(q.changePercent), recordedAt: iso(q.recordedAt) })),
    dailyPrices: dailyPrices.map((d) => ({ fundId: d.fundId, date: iso(d.date), open: toStr(d.open), high: toStr(d.high), low: toStr(d.low), close: toStr(d.close), adjustedClose: toStr(d.adjustedClose), volume: toStr(d.volume), source: d.source, fetchedAt: iso(d.fetchedAt) })),
    dividendEvents: events.map((e) => ({ id: e.id, fundId: e.fundId, kind: e.kind, type: e.type, source: e.source, ratePerShare: toStr(e.ratePerShare), dataCom: iso(e.dataCom), paymentDate: iso(e.paymentDate), approvedOn: iso(e.approvedOn), competence: e.competence, referenceLabel: e.referenceLabel, verified: e.verified, externalId: e.externalId, notes: e.notes, voidedAt: iso(e.voidedAt), voidReason: e.voidReason, createdAt: iso(e.createdAt) })),
    dividendReceipts: receipts.map((r) => ({ fundId: r.fundId, eventId: r.eventId, eligibleQuantity: toStr(r.eligibleQuantity), quantitySource: r.quantitySource, ratePerShare: toStr(r.ratePerShare), totalAmount: toStr(r.totalAmount), paymentDate: iso(r.paymentDate), notes: r.notes, voidedAt: iso(r.voidedAt), voidReason: r.voidReason, createdAt: iso(r.createdAt) })),
    simulations: simulations.map((s) => ({ id: s.id, name: s.name, description: s.description, origin: s.origin, config: s.config, createdAt: iso(s.createdAt), versions: s.versions.map((v) => ({ version: v.version, config: v.config, note: v.note, createdAt: iso(v.createdAt) })) })),
    goals: goals.map((g) => ({ name: g.name, metric: g.metric, target: toStr(g.target), customCurrent: toStr(g.customCurrent), simulationId: g.simulationId })),
    settings: settings ? { autoUpdateEnabled: settings.autoUpdateEnabled, quoteRefreshMinutes: settings.quoteRefreshMinutes, dividendRefreshHours: settings.dividendRefreshHours } : null,
    auditEvents: audit.map((a) => ({ entityType: a.entityType, entityId: a.entityId, action: a.action, data: a.data, createdAt: iso(a.createdAt) })),
    fixedIncomeAssets: fiAssets.map((f) => ({
      id: f.id, name: f.name, issuer: f.issuer, productType: f.productType, indexer: f.indexer, rate: toStr(f.rate),
      spreadAnnualPercent: toStr(f.spreadAnnualPercent), taxExempt: f.taxExempt, dailyLiquidity: f.dailyLiquidity,
      maturityDate: iso(f.maturityDate), notes: f.notes, archivedAt: iso(f.archivedAt), createdAt: iso(f.createdAt),
    })),
    fixedIncomeSimulations: fiSims.map((f) => ({ id: f.id, name: f.name, config: f.config, createdAt: iso(f.createdAt) })),
    fixedIncomeMovements: fiMovements.map((m) => ({ id: m.id, assetId: m.assetId, type: m.type, date: iso(m.date), amount: toStr(m.amount), notes: m.notes, createdAt: iso(m.createdAt) })),
  };
  const json = JSON.stringify(data);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    checksum: createHash("sha256").update(json).digest("hex"),
    data,
  };
}

// ---------------------------------------------------------------------------
// Restauração
// ---------------------------------------------------------------------------

const s = z.string();
const ns = z.string().nullable();
const isoDate = z.string().datetime({ offset: true }).or(z.string().datetime());
const nIso = isoDate.nullable();
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: s,
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  data: z.object({
    funds: z.array(z.object({ id: s, ticker: s, name: ns, segment: ns, cnpj: ns, notes: ns, archivedAt: nIso, createdAt: isoDate })),
    operations: z.array(z.object({ id: s, fundId: s, type: z.enum(["INITIAL_BALANCE", "BUY", "SELL"]), status: z.enum(["ACTIVE", "CANCELED", "SUPERSEDED"]), tradeDate: nIso, sequence: z.number().int(), quantity: s, unitPrice: s, fees: s, grossAmount: s, netAmount: s, notes: ns, correctsId: ns, voidedAt: nIso, voidReason: ns, createdAt: isoDate })),
    quotes: z.array(z.object({ fundId: s, price: s, source: z.enum(["MANUAL", "BRAPI", "BRAPI_DAILY_CLOSE"]), referenceDate: nIso, note: ns, marketTime: nIso, previousClose: ns, change: ns, changePercent: ns, recordedAt: isoDate })),
    dailyPrices: z.array(z.object({ fundId: s, date: isoDate, open: ns, high: ns, low: ns, close: s, adjustedClose: ns, volume: ns, source: z.enum(["MANUAL", "BRAPI", "BRAPI_DAILY_CLOSE"]), fetchedAt: isoDate })),
    dividendEvents: z.array(z.object({ id: s, fundId: s, kind: z.enum(["OFFICIAL", "FORECAST"]), type: z.enum(["INCOME", "AMORTIZATION"]), source: z.enum(["MANUAL", "BRAPI", "B3_FUNDOSNET"]), ratePerShare: s, dataCom: isoDate, paymentDate: nIso, approvedOn: nIso, competence: ns, referenceLabel: ns, verified: z.boolean().nullable(), externalId: ns, notes: ns, voidedAt: nIso, voidReason: ns, createdAt: isoDate })),
    dividendReceipts: z.array(z.object({ fundId: s, eventId: s, eligibleQuantity: s, quantitySource: z.enum(["LEDGER", "MANUAL"]), ratePerShare: s, totalAmount: s, paymentDate: isoDate, notes: ns, voidedAt: nIso, voidReason: ns, createdAt: isoDate })),
    simulations: z.array(z.object({ id: s, name: s, description: ns, origin: s, config: z.unknown(), createdAt: isoDate, versions: z.array(z.object({ version: z.number().int(), config: z.unknown(), note: ns, createdAt: isoDate })) })),
    goals: z.array(z.object({ name: s, metric: z.enum(["MONTHLY_INCOME", "PATRIMONY", "TOTAL_SHARES", "CUSTOM"]), target: s, customCurrent: ns, simulationId: ns })),
    settings: z.object({ autoUpdateEnabled: z.boolean(), quoteRefreshMinutes: z.number().int(), dividendRefreshHours: z.number().int() }).nullable(),
    auditEvents: z.array(z.object({ entityType: s, entityId: s, action: s, data: z.unknown(), createdAt: isoDate })),
    // Renda fixa (opcional: backups anteriores não têm estes campos).
    fixedIncomeAssets: z
      .array(z.object({
        id: s, name: s, issuer: ns, productType: z.enum(["CDB", "RDB", "LCI", "LCA", "TESOURO_SELIC", "OUTRO", "PREFIXADO", "TESOURO_IPCA"]),
        indexer: z.enum(["CDI", "SELIC", "PRE", "IPCA"]), rate: decimal, spreadAnnualPercent: decimal.nullable(), taxExempt: z.boolean(),
        dailyLiquidity: z.boolean(), maturityDate: nIso, notes: ns, archivedAt: nIso, createdAt: isoDate,
      }))
      .default([]),
    fixedIncomeSimulations: z.array(z.object({ id: s, name: s, config: z.unknown(), createdAt: isoDate })).default([]),
    fixedIncomeMovements: z
      .array(z.object({ id: s.optional(), assetId: s, type: z.enum(["DEPOSIT", "WITHDRAWAL"]), date: isoDate, amount: decimal, notes: ns, createdAt: isoDate }))
      .default([]),
  }),
});

export type BackupFile = z.infer<typeof backupSchema>;

const d = (v: string | null) => (v ? new Date(v) : null);

export async function restoreBackup(db: Database, userId: string, raw: unknown) {
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError("INVALID", "Arquivo de backup inválido ou de outra versão.");
  const backup = parsed.data;
  // O checksum é calculado sobre o JSON exportado; recalcular a partir do objeto
  // lido reproduz a mesma serialização (ordem de chaves preservada pelo JSON.parse).
  const checksum = createHash("sha256").update(JSON.stringify((raw as { data: unknown }).data)).digest("hex");
  if (checksum !== backup.checksum) throw new ServiceError("INVALID", "Checksum não confere: o arquivo foi alterado ou está corrompido.");

  const [funds, events, sims, goals, fixedIncome, fixedIncomeSims] = await Promise.all([
    db.fund.count({ where: { userId } }),
    db.dividendEvent.count({ where: { userId } }),
    db.simulation.count({ where: { userId } }),
    db.financialGoal.count({ where: { userId } }),
    db.fixedIncomeAsset.count({ where: { userId } }),
    db.fixedIncomeSimulation.count({ where: { userId } }),
  ]);
  if (funds + events + sims + goals + fixedIncome + fixedIncomeSims > 0) {
    throw new ServiceError("CONFLICT", "A restauração só é feita em uma conta sem dados (para nunca apagar ou sobrescrever registros). Use um banco novo ou outro usuário.");
  }
  // Configurações de simulação são revalidadas antes de gravar.
  for (const sim of backup.data.simulations) parseSimulationConfig(sim.config);
  const fiSimResults = backup.data.fixedIncomeSimulations.map((sim) => {
    try {
      return { sim, ...runFixedIncomeSimulation(sim.config as FixedIncomeSimulationFormInput) };
    } catch {
      throw new ServiceError("INVALID", `Simulação de renda fixa inválida no backup: ${sim.name}.`);
    }
  });

  const B = backup.data;
  return db.$transaction(
    async (tx) => {
      const ids = new Map<string, string>();
      const map = (old: string | null) => (old ? (ids.get(old) ?? null) : null);

      for (const f of B.funds) {
        const created = await tx.fund.create({ data: { userId, ticker: f.ticker, name: f.name, segment: f.segment, cnpj: f.cnpj, notes: f.notes, archivedAt: d(f.archivedAt), createdAt: new Date(f.createdAt) } });
        ids.set(f.id, created.id);
      }
      // Operações em ordem de registro (uma correção sempre vem depois da original).
      for (const o of [...B.operations].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        const fundId = map(o.fundId);
        if (!fundId) throw new ServiceError("INVALID", "Operação de fundo inexistente no backup.");
        const created = await tx.operation.create({
          data: {
            userId, fundId, type: o.type, status: o.status, tradeDate: d(o.tradeDate), sequence: o.sequence, quantity: o.quantity, unitPrice: o.unitPrice,
            fees: o.fees, grossAmount: o.grossAmount, netAmount: o.netAmount, notes: o.notes, correctsId: map(o.correctsId), voidedAt: d(o.voidedAt),
            voidReason: o.voidReason, createdAt: new Date(o.createdAt),
          },
        });
        ids.set(o.id, created.id);
      }
      // Reprocessa o livro-razão (revalida o histórico e regrava posição/derivados).
      for (const f of B.funds) await rebuildFundLedger(tx, ids.get(f.id)!);
      if (B.quotes.length) {
        await tx.priceQuote.createMany({ data: B.quotes.map((q) => ({ fundId: map(q.fundId)!, price: q.price, source: q.source, referenceDate: d(q.referenceDate), note: q.note, marketTime: d(q.marketTime), previousClose: q.previousClose, change: q.change, changePercent: q.changePercent, recordedAt: new Date(q.recordedAt) })) });
      }
      if (B.dailyPrices.length) {
        await tx.dailyPrice.createMany({ data: B.dailyPrices.map((p) => ({ fundId: map(p.fundId)!, date: new Date(p.date), open: p.open, high: p.high, low: p.low, close: p.close, adjustedClose: p.adjustedClose, volume: p.volume, source: p.source, fetchedAt: new Date(p.fetchedAt) })) });
      }
      for (const e of B.dividendEvents) {
        const created = await tx.dividendEvent.create({
          data: { userId, fundId: map(e.fundId)!, kind: e.kind, type: e.type, source: e.source, ratePerShare: e.ratePerShare, dataCom: new Date(e.dataCom), paymentDate: d(e.paymentDate), approvedOn: d(e.approvedOn), competence: e.competence, referenceLabel: e.referenceLabel, verified: e.verified, externalId: e.externalId, notes: e.notes, voidedAt: d(e.voidedAt), voidReason: e.voidReason, createdAt: new Date(e.createdAt) },
        });
        ids.set(e.id, created.id);
      }
      for (const r of B.dividendReceipts) {
        await tx.dividendReceipt.create({
          data: { userId, fundId: map(r.fundId)!, eventId: map(r.eventId)!, eligibleQuantity: r.eligibleQuantity, quantitySource: r.quantitySource, ratePerShare: r.ratePerShare, totalAmount: r.totalAmount, paymentDate: new Date(r.paymentDate), notes: r.notes, voidedAt: d(r.voidedAt), voidReason: r.voidReason, createdAt: new Date(r.createdAt) },
        });
      }
      for (const sim of B.simulations) {
        const created = await tx.simulation.create({
          data: { userId, name: sim.name, description: sim.description, origin: sim.origin, config: sim.config as Prisma.InputJsonValue, engineVersion: (parseSimulationConfig(sim.config)).engineVersion, createdAt: new Date(sim.createdAt) },
        });
        ids.set(sim.id, created.id);
        if (sim.versions.length) {
          await tx.simulationVersion.createMany({ data: sim.versions.map((v) => ({ simulationId: created.id, version: v.version, config: v.config as Prisma.InputJsonValue, engineVersion: parseSimulationConfig(v.config).engineVersion, note: v.note, createdAt: new Date(v.createdAt) })) });
        }
      }
      for (const g of B.goals) {
        await tx.financialGoal.create({ data: { userId, name: g.name, metric: g.metric, target: g.target, customCurrent: g.customCurrent, simulationId: map(g.simulationId) } });
      }
      for (const f of B.fixedIncomeAssets) {
        const created = await tx.fixedIncomeAsset.create({
          data: {
            userId, name: f.name, issuer: f.issuer, productType: f.productType, indexer: f.indexer, rate: f.rate, spreadAnnualPercent: f.spreadAnnualPercent,
            taxExempt: f.taxExempt, dailyLiquidity: f.dailyLiquidity, maturityDate: d(f.maturityDate), notes: f.notes, archivedAt: d(f.archivedAt),
            createdAt: new Date(f.createdAt),
          },
        });
        ids.set(f.id, created.id);
      }
      // Ordem de registro preservada (desempate de movimentos do mesmo dia).
      for (const m of [...B.fixedIncomeMovements].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        const assetId = map(m.assetId);
        if (!assetId) throw new ServiceError("INVALID", "Movimento de renda fixa de título inexistente no backup.");
        const created = await tx.fixedIncomeMovement.create({ data: { userId, assetId, type: m.type, date: new Date(m.date), amount: m.amount, notes: m.notes, createdAt: new Date(m.createdAt) } });
        if (m.id) ids.set(m.id, created.id);
      }
      for (const { sim, config, result } of fiSimResults) {
        const created = await tx.fixedIncomeSimulation.create({
          data: { userId, name: sim.name, config: config as unknown as Prisma.InputJsonValue, summary: simulationSummaryJson(result), createdAt: new Date(sim.createdAt) },
        });
        ids.set(sim.id, created.id);
      }
      if (B.settings) {
        await tx.userSettings.upsert({ where: { userId }, create: { userId, ...B.settings }, update: B.settings });
      }
      if (B.auditEvents.length) {
        await tx.auditEvent.createMany({ data: B.auditEvents.map((a) => ({ userId, entityType: a.entityType, entityId: map(a.entityId) ?? a.entityId, action: a.action, data: (a.data ?? undefined) as Prisma.InputJsonValue | undefined, createdAt: new Date(a.createdAt) })) });
      }
      await tx.auditEvent.create({ data: { userId, entityType: "backup", entityId: backup.checksum.slice(0, 16), action: "restore", data: { exportedAt: backup.exportedAt, funds: B.funds.length, operations: B.operations.length, fixedIncomeAssets: B.fixedIncomeAssets.length } } });
      return { funds: B.funds.length, operations: B.operations.length, dividendEvents: B.dividendEvents.length, receipts: B.dividendReceipts.length, simulations: B.simulations.length, goals: B.goals.length, fixedIncomeAssets: B.fixedIncomeAssets.length, fixedIncomeMovements: B.fixedIncomeMovements.length, fixedIncomeSimulations: B.fixedIncomeSimulations.length };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
