import type { Database } from "@/server/db/factory";
import type { Prisma } from "@/generated/prisma/client";
import { todayIsoDate } from "@/domain/dates";
import { addDays, toIso, type IsoDate } from "@/domain/fixed-income/calendar";
import {
  computeFixedIncome,
  type FixedIncomeMovementInput,
  type FixedIncomeResult,
} from "@/domain/fixed-income/engine";
import { FinDecimal, roundMoney } from "@/domain/money";
import {
  fixedIncomeAssetSchema,
  fixedIncomeMovementSchema,
  type FixedIncomeAssetFormInput,
  type FixedIncomeMovementFormInput,
} from "@/validation/fixed-income";
import { recordAudit } from "../audit";
import { ServiceError } from "../errors";
import { lastRateBefore, loadIndexRates, type RateIndexer } from "./index-rate-service";

/**
 * Casos de uso de renda fixa. Todas as funções recebem o userId do usuário
 * autenticado e só enxergam títulos dele. Valores são ESTIMATIVAS.
 */

type AssetRow = Prisma.FixedIncomeAssetGetPayload<{ include: { movements: true } }>;

/**
 * Tolerância para resgates acima do saldo líquido estimado: até
 * max(R$ 1,00; 1% do resgate) a diferença é atribuída à estimativa (o resgate
 * zera o título); acima disso o resgate é recusado.
 */
export function withdrawalTolerance(amount: FinDecimal) {
  return FinDecimal.max(new FinDecimal(1), amount.times("0.01"));
}

function supportedIndexer(indexer: string): RateIndexer {
  if (indexer === "CDI" || indexer === "SELIC") return indexer;
  throw new ServiceError("INVALID", "Indexador ainda não suportado nesta versão.");
}

function toMovementInputs(movements: AssetRow["movements"]): FixedIncomeMovementInput[] {
  return [...movements]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((m, order) => ({ id: m.id, type: m.type, date: toIso(m.date), amount: m.amount.toString(), order }));
}

/** Taxas necessárias para calcular de `start` a `asOf` (inclui a última anterior, para projeção). */
async function ratesFor(db: Database, indexer: RateIndexer, start: IsoDate, asOf: IsoDate) {
  const rates = await loadIndexRates(db, indexer, start, asOf);
  const previous = await lastRateBefore(db, indexer, start);
  if (previous) rates.set(previous.date, previous.dailyRatePercent);
  return rates;
}

async function compute(db: Database, asset: AssetRow, movements: FixedIncomeMovementInput[], asOf: IsoDate) {
  const indexer = supportedIndexer(asset.indexer);
  const start = movements.reduce<IsoDate>((min, m) => (m.date < min ? m.date : min), asOf);
  return computeFixedIncome({
    terms: {
      rate: asset.rate.toString(),
      spreadAnnualPercent: asset.spreadAnnualPercent?.toString() ?? null,
      taxExempt: asset.taxExempt,
    },
    movements,
    rates: await ratesFor(db, indexer, start, asOf),
    asOf,
  });
}

/** Recusa históricos em que algum resgate supera o saldo líquido estimado. */
function assertWithdrawalsFit(result: FixedIncomeResult) {
  for (const w of result.withdrawals) {
    if (w.excess.gt(withdrawalTolerance(w.net))) {
      const available = roundMoney(w.net.minus(w.excess)).toFixed(2);
      throw new ServiceError(
        "INVALID",
        `O resgate de ${toIsoBr(w.date)} (R$ ${roundMoney(w.net).toFixed(2)}) é maior que o saldo líquido estimado na data (R$ ${available}).`,
      );
    }
  }
}

function toIsoBr(iso: IsoDate) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

async function findAsset(db: Database | Prisma.TransactionClient, userId: string, assetId: string) {
  const asset = await db.fixedIncomeAsset.findFirst({ where: { id: assetId, userId }, include: { movements: true } });
  if (!asset) throw new ServiceError("NOT_FOUND", "Título não encontrado.");
  return asset;
}

async function lockAsset(tx: Prisma.TransactionClient, assetId: string) {
  await tx.$queryRaw`SELECT id FROM fixed_income_assets WHERE id = ${assetId} FOR UPDATE`;
}

// ---------------------------------------------------------------- títulos

export async function createFixedIncomeAsset(db: Database, userId: string, input: FixedIncomeAssetFormInput) {
  const data = fixedIncomeAssetSchema.parse(input);
  return db.$transaction(async (tx) => {
    const asset = await tx.fixedIncomeAsset.create({ data: { userId, ...data } });
    await recordAudit(tx, {
      userId,
      entityType: "fixed_income_asset",
      entityId: asset.id,
      action: "create",
      data: { ...data, maturityDate: data.maturityDate ? toIso(data.maturityDate) : null },
    });
    return asset;
  });
}

export async function updateFixedIncomeAsset(
  db: Database,
  userId: string,
  assetId: string,
  input: FixedIncomeAssetFormInput,
) {
  const data = fixedIncomeAssetSchema.parse(input);
  return db.$transaction(async (tx) => {
    await findAsset(tx, userId, assetId);
    await lockAsset(tx, assetId);
    const asset = await tx.fixedIncomeAsset.update({ where: { id: assetId }, data });
    await recordAudit(tx, {
      userId,
      entityType: "fixed_income_asset",
      entityId: assetId,
      action: "update",
      data: { ...data, maturityDate: data.maturityDate ? toIso(data.maturityDate) : null },
    });
    // Mudar taxa/isenção altera o bruto equivalente dos resgates: confere de novo.
    const updated = await findAsset(tx, userId, assetId);
    assertWithdrawalsFit(await compute(db, updated, toMovementInputs(updated.movements), todayIsoDate()));
    return asset;
  });
}

export async function setFixedIncomeAssetArchived(db: Database, userId: string, assetId: string, archived: boolean) {
  return db.$transaction(async (tx) => {
    await findAsset(tx, userId, assetId);
    const asset = await tx.fixedIncomeAsset.update({
      where: { id: assetId },
      data: { archivedAt: archived ? new Date() : null },
    });
    await recordAudit(tx, {
      userId,
      entityType: "fixed_income_asset",
      entityId: assetId,
      action: archived ? "archive" : "restore",
    });
    return asset;
  });
}

// ------------------------------------------------------------- movimentos

async function changeMovements(
  db: Database,
  userId: string,
  assetId: string,
  apply: (tx: Prisma.TransactionClient) => Promise<{ id: string; action: string; data?: Prisma.InputJsonValue }>,
) {
  return db.$transaction(async (tx) => {
    await findAsset(tx, userId, assetId);
    await lockAsset(tx, assetId);
    const change = await apply(tx);
    const asset = await findAsset(tx, userId, assetId);
    const result = await compute(db, asset, toMovementInputs(asset.movements), todayIsoDate());
    assertWithdrawalsFit(result);
    await recordAudit(tx, {
      userId,
      entityType: "fixed_income_movement",
      entityId: change.id,
      action: change.action,
      data: change.data,
    });
    return change.id;
  });
}

function movementAuditData(assetId: string, m: { type: string; date: Date; amount: string; notes: string | null }) {
  return { assetId, type: m.type, date: toIso(m.date), amount: m.amount, notes: m.notes };
}

export async function addFixedIncomeMovement(
  db: Database,
  userId: string,
  assetId: string,
  input: FixedIncomeMovementFormInput,
) {
  const data = fixedIncomeMovementSchema.parse(input);
  return changeMovements(db, userId, assetId, async (tx) => {
    const m = await tx.fixedIncomeMovement.create({ data: { userId, assetId, ...data } });
    return { id: m.id, action: "create", data: movementAuditData(assetId, data) };
  });
}

async function findMovement(tx: Prisma.TransactionClient, userId: string, movementId: string) {
  const m = await tx.fixedIncomeMovement.findFirst({ where: { id: movementId, userId } });
  if (!m) throw new ServiceError("NOT_FOUND", "Movimento não encontrado.");
  return m;
}

export async function updateFixedIncomeMovement(
  db: Database,
  userId: string,
  movementId: string,
  input: FixedIncomeMovementFormInput,
) {
  const data = fixedIncomeMovementSchema.parse(input);
  const existing = await db.fixedIncomeMovement.findFirst({ where: { id: movementId, userId } });
  if (!existing) throw new ServiceError("NOT_FOUND", "Movimento não encontrado.");
  return changeMovements(db, userId, existing.assetId, async (tx) => {
    const before = await findMovement(tx, userId, movementId);
    await tx.fixedIncomeMovement.update({ where: { id: movementId }, data });
    return {
      id: movementId,
      action: "update",
      data: {
        before: movementAuditData(before.assetId, { ...before, amount: before.amount.toString() }),
        after: movementAuditData(before.assetId, data),
      },
    };
  });
}

export async function deleteFixedIncomeMovement(db: Database, userId: string, movementId: string) {
  const existing = await db.fixedIncomeMovement.findFirst({ where: { id: movementId, userId } });
  if (!existing) throw new ServiceError("NOT_FOUND", "Movimento não encontrado.");
  return changeMovements(db, userId, existing.assetId, async (tx) => {
    const before = await findMovement(tx, userId, movementId);
    await tx.fixedIncomeMovement.delete({ where: { id: movementId } });
    return {
      id: movementId,
      action: "delete",
      data: movementAuditData(before.assetId, { ...before, amount: before.amount.toString() }),
    };
  });
}

// --------------------------------------------------------------- consultas

export interface FixedIncomeAssetView {
  id: string;
  name: string;
  issuer: string | null;
  productType: AssetRow["productType"];
  indexer: AssetRow["indexer"];
  rate: string;
  spreadAnnualPercent: string | null;
  taxExempt: boolean;
  dailyLiquidity: boolean;
  maturityDate: IsoDate | null;
  notes: string | null;
  archivedAt: Date | null;
  movements: { id: string; type: "DEPOSIT" | "WITHDRAWAL"; date: IsoDate; amount: string; notes: string | null }[];
  result: FixedIncomeResult;
}

async function toView(db: Database, asset: AssetRow, asOf: IsoDate): Promise<FixedIncomeAssetView> {
  const movements = toMovementInputs(asset.movements);
  const byId = new Map(asset.movements.map((m) => [m.id, m]));
  return {
    id: asset.id,
    name: asset.name,
    issuer: asset.issuer,
    productType: asset.productType,
    indexer: asset.indexer,
    rate: asset.rate.toString(),
    spreadAnnualPercent: asset.spreadAnnualPercent?.toString() ?? null,
    taxExempt: asset.taxExempt,
    dailyLiquidity: asset.dailyLiquidity,
    maturityDate: asset.maturityDate ? toIso(asset.maturityDate) : null,
    notes: asset.notes,
    archivedAt: asset.archivedAt,
    movements: movements.map((m) => ({
      id: m.id,
      type: m.type,
      date: m.date,
      amount: String(m.amount),
      notes: byId.get(m.id)?.notes ?? null,
    })),
    result: await compute(db, asset, movements, asOf),
  };
}

export async function getFixedIncomeAsset(db: Database, userId: string, assetId: string, asOf = todayIsoDate()) {
  return toView(db, await findAsset(db, userId, assetId), asOf);
}

export interface FixedIncomeSummary {
  assets: FixedIncomeAssetView[];
  totals: {
    principal: FinDecimal;
    gross: FinDecimal;
    iof: FinDecimal;
    incomeTax: FinDecimal;
    net: FinDecimal;
    monthEarnings: FinDecimal;
    accumulatedEarnings: FinDecimal;
  };
  /** Menor "índices atualizados até" entre os títulos com saldo (null = sem índice). */
  ratesKnownUntil: IsoDate | null;
  hasProjection: boolean;
}

export async function listFixedIncomeAssets(
  db: Database,
  userId: string,
  opts: { includeArchived?: boolean; asOf?: IsoDate } = {},
): Promise<FixedIncomeSummary> {
  const asOf = opts.asOf ?? todayIsoDate();
  const rows = await db.fixedIncomeAsset.findMany({
    where: { userId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    include: { movements: true },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
  });
  const assets = await Promise.all(rows.map((row) => toView(db, row, asOf)));
  const zero = new FinDecimal(0);
  const totals = { principal: zero, gross: zero, iof: zero, incomeTax: zero, net: zero, monthEarnings: zero, accumulatedEarnings: zero };
  let ratesKnownUntil: IsoDate | null = null;
  let hasProjection = false;
  for (const a of assets) {
    if (a.archivedAt) continue;
    const r = a.result;
    totals.principal = totals.principal.plus(r.current.principal);
    totals.gross = totals.gross.plus(r.current.gross);
    totals.iof = totals.iof.plus(r.current.iof);
    totals.incomeTax = totals.incomeTax.plus(r.current.incomeTax);
    totals.net = totals.net.plus(r.current.net);
    totals.monthEarnings = totals.monthEarnings.plus(r.monthEarnings);
    totals.accumulatedEarnings = totals.accumulatedEarnings.plus(r.accumulatedEarnings);
    if (r.current.gross.gt(0)) {
      if (r.ratesKnownUntil && (!ratesKnownUntil || r.ratesKnownUntil < ratesKnownUntil)) ratesKnownUntil = r.ratesKnownUntil;
      if (r.projectedBusinessDays > 0 || r.missingBusinessDays > 0) hasProjection = true;
    }
  }
  return { assets, totals, ratesKnownUntil, hasProjection };
}

/**
 * Data mais antiga de movimento por indexador (do usuário, ou de todos se
 * omitido), usada para decidir desde quando o cache de índices precisa existir.
 */
export async function earliestMovementByIndexer(db: Database, userId?: string) {
  const out: Partial<Record<RateIndexer, IsoDate>> = {};
  for (const indexer of ["CDI", "SELIC"] as const) {
    const first = await db.fixedIncomeMovement.findFirst({
      where: { asset: { indexer }, ...(userId ? { userId } : {}) },
      orderBy: { date: "asc" },
      select: { date: true },
    });
    // Alguns dias antes, para ter a taxa anterior (projeção de lacunas).
    if (first) out[indexer] = addDays(toIso(first.date), -10);
  }
  return out;
}
