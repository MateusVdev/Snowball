import type { Database } from "@/server/db/factory";
import type { Prisma } from "@/generated/prisma/client";
import { operationAmounts } from "@/domain/portfolio/ledger";
import {
  historyFilterSchema,
  initialBalanceSchema,
  reasonSchema,
  tradeSchema,
  type HistoryFilter,
  type InitialBalanceFormInput,
  type InitialBalanceInput,
  type TradeFormInput,
  type TradeInput,
} from "@/validation/portfolio";
import { recordAudit } from "../audit";
import { ServiceError } from "../errors";
import { insertInitialBalance } from "./fund-service";
import { lockFund, rebuildFundLedger } from "./ledger-sync";

/**
 * Casos de uso de operações. Regras de integridade:
 * - Toda alteração roda em transação, com lock do fundo, e termina com o
 *   reprocessamento completo do livro-razão (que valida o histórico).
 * - Operações nunca são apagadas nem editadas: cancelar = status CANCELED;
 *   corrigir = nova operação + original SUPERSEDED. Ambos exigem motivo.
 */

export interface OperationView {
  id: string;
  fundId: string;
  ticker: string;
  type: "INITIAL_BALANCE" | "BUY" | "SELL";
  status: "ACTIVE" | "CANCELED" | "SUPERSEDED";
  tradeDate: Date | null;
  quantity: string;
  unitPrice: string;
  fees: string;
  grossAmount: string;
  netAmount: string;
  notes: string | null;
  quantityAfter: string | null;
  averagePriceAfter: string | null;
  costOfSold: string | null;
  realizedResult: string | null;
  correctsId: string | null;
  correctedById: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
}

const operationInclude = {
  fund: { select: { ticker: true } },
  correctedBy: { select: { id: true } },
} satisfies Prisma.OperationInclude;

type OperationRow = Prisma.OperationGetPayload<{ include: typeof operationInclude }>;

function toOperationView(op: OperationRow): OperationView {
  const s = (v: Prisma.Decimal | null) => (v === null ? null : v.toString());
  return {
    id: op.id,
    fundId: op.fundId,
    ticker: op.fund.ticker,
    type: op.type,
    status: op.status,
    tradeDate: op.tradeDate,
    quantity: op.quantity.toString(),
    unitPrice: op.unitPrice.toString(),
    fees: op.fees.toString(),
    grossAmount: op.grossAmount.toString(),
    netAmount: op.netAmount.toString(),
    notes: op.notes,
    quantityAfter: s(op.quantityAfter),
    averagePriceAfter: s(op.averagePriceAfter),
    costOfSold: s(op.costOfSold),
    realizedResult: s(op.realizedResult),
    correctsId: op.correctsId,
    correctedById: op.correctedBy?.id ?? null,
    voidedAt: op.voidedAt,
    voidReason: op.voidReason,
    createdAt: op.createdAt,
  };
}

async function lockOwnedActiveFund(
  tx: Prisma.TransactionClient,
  userId: string,
  fundId: string,
) {
  const fund = await tx.fund.findFirst({ where: { id: fundId, userId } });
  if (!fund) throw new ServiceError("NOT_FOUND", "Fundo não encontrado.");
  await lockFund(tx, fundId);
  if (fund.archivedAt) {
    throw new ServiceError(
      "CONFLICT",
      `${fund.ticker} está arquivado. Restaure o fundo para registrar operações.`,
    );
  }
  return fund;
}

function tradeData(trade: TradeInput) {
  const { grossAmount, netAmount } = operationAmounts(
    trade.type,
    trade.quantity,
    trade.unitPrice,
    trade.fees,
  );
  if (trade.type === "SELL" && netAmount.isNegative()) {
    throw new ServiceError("INVALID", "As taxas não podem superar o valor da venda.");
  }
  return {
    type: trade.type,
    tradeDate: trade.tradeDate,
    quantity: trade.quantity,
    unitPrice: trade.unitPrice,
    fees: trade.fees,
    grossAmount: grossAmount.toFixed(2),
    netAmount: netAmount.toFixed(2),
    notes: trade.notes,
  };
}

async function loadView(tx: Prisma.TransactionClient | Database, id: string) {
  const op = await tx.operation.findUniqueOrThrow({
    where: { id },
    include: operationInclude,
  });
  return toOperationView(op);
}

/** Registra uma compra ou venda. Venda acima do saldo é rejeitada (rollback). */
export async function registerTrade(
  db: Database,
  userId: string,
  fundId: string,
  input: TradeFormInput,
): Promise<OperationView> {
  const trade = tradeSchema.parse(input);
  return db.$transaction(async (tx) => {
    await lockOwnedActiveFund(tx, userId, fundId);
    const op = await tx.operation.create({
      data: { userId, fundId, ...tradeData(trade) },
    });
    await rebuildFundLedger(tx, fundId);
    await recordAudit(tx, {
      userId,
      entityType: "operation",
      entityId: op.id,
      action: "create",
      data: {
        fundId,
        type: trade.type,
        tradeDate: trade.tradeDate.toISOString().slice(0, 10),
        quantity: trade.quantity,
        unitPrice: trade.unitPrice,
        fees: trade.fees,
      },
    });
    return loadView(tx, op.id);
  });
}

/** Registra o saldo inicial de um fundo que ainda não tem um ativo. */
export async function registerInitialBalance(
  db: Database,
  userId: string,
  fundId: string,
  input: InitialBalanceFormInput,
): Promise<OperationView> {
  const data: InitialBalanceInput = initialBalanceSchema.parse(input);
  return db.$transaction(async (tx) => {
    await lockOwnedActiveFund(tx, userId, fundId);
    const existing = await tx.operation.count({
      where: { fundId, type: "INITIAL_BALANCE", status: "ACTIVE" },
    });
    if (existing > 0) {
      throw new ServiceError(
        "CONFLICT",
        "Este fundo já possui saldo inicial. Para alterá-lo, registre uma correção.",
      );
    }
    const op = await insertInitialBalance(tx, userId, fundId, data);
    await rebuildFundLedger(tx, fundId);
    return loadView(tx, op.id);
  });
}

async function findActiveOwnedOperation(
  tx: Prisma.TransactionClient,
  userId: string,
  operationId: string,
) {
  const op = await tx.operation.findFirst({ where: { id: operationId, userId } });
  if (!op) throw new ServiceError("NOT_FOUND", "Operação não encontrada.");
  await lockOwnedActiveFund(tx, userId, op.fundId);
  // Relê após o lock para evitar corrida com outra correção/cancelamento.
  const fresh = await tx.operation.findUniqueOrThrow({ where: { id: op.id } });
  if (fresh.status !== "ACTIVE") {
    throw new ServiceError(
      "CONFLICT",
      "Esta operação já foi cancelada ou corrigida e não pode ser alterada.",
    );
  }
  return fresh;
}

/**
 * Cancela uma operação (com motivo). Rejeitado se deixar o histórico
 * inconsistente (ex.: cancelar uma compra cujas cotas já foram vendidas).
 */
export async function cancelOperation(
  db: Database,
  userId: string,
  operationId: string,
  rawReason: string,
): Promise<OperationView> {
  const reason = reasonSchema.parse(rawReason);
  return db.$transaction(async (tx) => {
    const op = await findActiveOwnedOperation(tx, userId, operationId);
    await tx.operation.update({
      where: { id: op.id },
      data: { status: "CANCELED", voidedAt: new Date(), voidReason: reason },
    });
    await rebuildFundLedger(tx, op.fundId);
    await recordAudit(tx, {
      userId,
      entityType: "operation",
      entityId: op.id,
      action: "cancel",
      data: { reason },
    });
    return loadView(tx, op.id);
  });
}

/**
 * Corrige uma operação: cria a versão corrigida (mesmo fundo e tipo, herda a
 * ordem de registro) e marca a original como SUPERSEDED, com motivo.
 */
export async function correctOperation(
  db: Database,
  userId: string,
  operationId: string,
  input: Omit<TradeFormInput, "type"> | InitialBalanceFormInput,
  rawReason: string,
): Promise<OperationView> {
  const reason = reasonSchema.parse(rawReason);
  return db.$transaction(async (tx) => {
    const original = await findActiveOwnedOperation(tx, userId, operationId);

    await tx.operation.update({
      where: { id: original.id },
      data: { status: "SUPERSEDED", voidedAt: new Date(), voidReason: reason },
    });

    let data: Prisma.OperationUncheckedCreateInput;
    if (original.type === "INITIAL_BALANCE") {
      const parsed = initialBalanceSchema.parse(input);
      const { grossAmount, netAmount } = operationAmounts(
        "INITIAL_BALANCE",
        parsed.quantity,
        parsed.averagePrice,
        "0",
      );
      data = {
        userId,
        fundId: original.fundId,
        type: "INITIAL_BALANCE",
        tradeDate: null,
        quantity: parsed.quantity,
        unitPrice: parsed.averagePrice,
        fees: "0",
        grossAmount: grossAmount.toFixed(2),
        netAmount: netAmount.toFixed(2),
        notes: parsed.notes,
      };
    } else {
      const parsed = tradeSchema.parse({ ...input, type: original.type });
      data = { userId, fundId: original.fundId, ...tradeData(parsed) };
    }

    const corrected = await tx.operation.create({
      data: { ...data, sequence: original.sequence, correctsId: original.id },
    });
    await rebuildFundLedger(tx, original.fundId);
    await recordAudit(tx, {
      userId,
      entityType: "operation",
      entityId: corrected.id,
      action: "create",
      data: { correctsId: original.id, reason },
    });
    await recordAudit(tx, {
      userId,
      entityType: "operation",
      entityId: original.id,
      action: "correct",
      data: {
        reason,
        correctedById: corrected.id,
        before: {
          tradeDate: original.tradeDate?.toISOString().slice(0, 10) ?? null,
          quantity: original.quantity.toString(),
          unitPrice: original.unitPrice.toString(),
          fees: original.fees.toString(),
        },
        after: {
          tradeDate: corrected.tradeDate?.toISOString().slice(0, 10) ?? null,
          quantity: corrected.quantity.toString(),
          unitPrice: corrected.unitPrice.toString(),
          fees: corrected.fees.toString(),
        },
      },
    });
    return loadView(tx, corrected.id);
  });
}

/**
 * Histórico com filtros (fundo, período, tipo, ativas/todas).
 * Ordem: mais recentes primeiro; saldos iniciais (sem data) ao final.
 */
export async function listOperations(
  db: Database,
  userId: string,
  rawFilter: Partial<Record<keyof HistoryFilter, string | undefined>> = {},
): Promise<{ filter: HistoryFilter; operations: OperationView[] }> {
  const filter = historyFilterSchema.parse(rawFilter);
  const hasPeriod = Boolean(filter.from || filter.to);
  const operations = await db.operation.findMany({
    where: {
      userId,
      ...(filter.fund ? { fund: { ticker: filter.fund } } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.status === "all" ? {} : { status: "ACTIVE" }),
      // Com período, só entram operações datadas (saldo inicial não tem data).
      ...(hasPeriod
        ? {
            tradeDate: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    },
    include: operationInclude,
    orderBy: [
      { tradeDate: { sort: "desc", nulls: "last" } },
      { sequence: "desc" },
      { createdAt: "desc" },
    ],
  });
  return { filter, operations: operations.map(toOperationView) };
}

export async function getOperation(
  db: Database,
  userId: string,
  operationId: string,
): Promise<OperationView | null> {
  const op = await db.operation.findFirst({
    where: { id: operationId, userId },
    include: operationInclude,
  });
  return op ? toOperationView(op) : null;
}

/** Operações de um fundo (todas, inclusive inativas), na ordem do livro-razão inversa. */
export async function listFundOperations(
  db: Database,
  userId: string,
  fundId: string,
): Promise<OperationView[]> {
  const ops = await db.operation.findMany({
    where: { userId, fundId },
    include: operationInclude,
    orderBy: [
      { tradeDate: { sort: "desc", nulls: "last" } },
      { sequence: "desc" },
      { createdAt: "desc" },
    ],
  });
  return ops.map(toOperationView);
}

/** Eventos de auditoria de uma operação (mais antigos primeiro). */
export async function listOperationAudit(db: Database, userId: string, operationId: string) {
  return db.auditEvent.findMany({
    where: { userId, entityType: "operation", entityId: operationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, action: true, data: true, createdAt: true },
  });
}
