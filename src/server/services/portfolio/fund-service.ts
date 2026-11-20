import type { Database } from "@/server/db/factory";
import type { Prisma } from "@/generated/prisma/client";
import { operationAmounts } from "@/domain/portfolio/ledger";
import {
  computePortfolioTotals,
  computePositionMetrics,
  type PortfolioTotals,
  type PositionMetrics,
} from "@/domain/portfolio/metrics";
import {
  createFundSchema,
  fundInfoSchema,
  initialBalanceSchema,
  manualQuoteSchema,
  tickerSchema,
  type CreateFundInput,
  type FundInfoFormInput,
  type InitialBalanceFormInput,
  type InitialBalanceInput,
  type ManualQuoteFormInput,
  type ManualQuoteInput,
} from "@/validation/portfolio";
import { recordAudit } from "../audit";
import { ServiceError } from "../errors";
import { dec, lockFund, rebuildFundLedger } from "./ledger-sync";

/**
 * Casos de uso de fundos e cotações. Todas as funções recebem o userId do
 * usuário autenticado e só enxergam fundos dele.
 */

export interface QuoteView {
  id: string;
  price: string;
  source: "MANUAL";
  referenceDate: Date | null;
  note: string | null;
  recordedAt: Date;
}

export interface FundPositionView {
  fundId: string;
  ticker: string;
  name: string | null;
  segment: string | null;
  notes: string | null;
  archivedAt: Date | null;
  quote: QuoteView | null;
  metrics: PositionMetrics;
}

export interface PortfolioView {
  positions: FundPositionView[];
  totals: PortfolioTotals;
}

const fundWithPositionInclude = {
  position: true,
  quotes: { orderBy: { recordedAt: "desc" }, take: 1 },
} satisfies Prisma.FundInclude;

type FundWithPosition = Prisma.FundGetPayload<{
  include: typeof fundWithPositionInclude;
}>;

function toQuoteView(quote: FundWithPosition["quotes"][number]): QuoteView {
  return {
    id: quote.id,
    price: quote.price.toString(),
    source: quote.source,
    referenceDate: quote.referenceDate,
    note: quote.note,
    recordedAt: quote.recordedAt,
  };
}

function toPositionView(fund: FundWithPosition): FundPositionView {
  const quote = fund.quotes[0] ? toQuoteView(fund.quotes[0]) : null;
  return {
    fundId: fund.id,
    ticker: fund.ticker,
    name: fund.name,
    segment: fund.segment,
    notes: fund.notes,
    archivedAt: fund.archivedAt,
    quote,
    metrics: computePositionMetrics({
      quantity: dec(fund.position?.quantity) ?? "0",
      totalCost: dec(fund.position?.totalCost) ?? "0",
      realizedResult: dec(fund.position?.realizedResult) ?? "0",
      currentPrice: quote ? quote.price : null,
    }),
  };
}

async function findOwnedFund(
  db: Database | Prisma.TransactionClient,
  userId: string,
  fundId: string,
) {
  const fund = await db.fund.findFirst({ where: { id: fundId, userId } });
  if (!fund) throw new ServiceError("NOT_FOUND", "Fundo não encontrado.");
  return fund;
}

/** Cria o fundo; opcionalmente já com saldo inicial e cotação manual. */
export async function createFund(
  db: Database,
  userId: string,
  input: CreateFundInput,
  extras: {
    initialBalance?: InitialBalanceFormInput | null;
    quote?: ManualQuoteFormInput | null;
  } = {},
) {
  const data = createFundSchema.parse(input);
  const initial = extras.initialBalance
    ? initialBalanceSchema.parse(extras.initialBalance)
    : null;
  const quote = extras.quote ? manualQuoteSchema.parse(extras.quote) : null;

  const existing = await db.fund.findUnique({
    where: { userId_ticker: { userId, ticker: data.ticker } },
  });
  if (existing) {
    throw new ServiceError(
      "CONFLICT",
      existing.archivedAt
        ? `${data.ticker} já existe e está arquivado. Restaure-o em vez de cadastrar de novo.`
        : `${data.ticker} já está cadastrado.`,
    );
  }

  return db.$transaction(async (tx) => {
    const fund = await tx.fund.create({ data: { userId, ...data } });
    await recordAudit(tx, {
      userId,
      entityType: "fund",
      entityId: fund.id,
      action: "create",
      data: { ...data },
    });
    if (initial) await insertInitialBalance(tx, userId, fund.id, initial);
    if (quote) await insertManualQuote(tx, userId, fund.id, quote);
    await rebuildFundLedger(tx, fund.id);
    return fund;
  });
}

export async function updateFundInfo(
  db: Database,
  userId: string,
  fundId: string,
  input: FundInfoFormInput,
) {
  const data = fundInfoSchema.parse(input);
  return db.$transaction(async (tx) => {
    const before = await findOwnedFund(tx, userId, fundId);
    const fund = await tx.fund.update({ where: { id: fundId }, data });
    await recordAudit(tx, {
      userId,
      entityType: "fund",
      entityId: fundId,
      action: "update",
      data: {
        before: { name: before.name, segment: before.segment, notes: before.notes },
        after: { ...data },
      },
    });
    return fund;
  });
}

/**
 * "Remover" um fundo = arquivar. Exige posição zerada; o histórico de
 * operações e cotações é preservado e o fundo pode ser restaurado.
 */
export async function archiveFund(db: Database, userId: string, fundId: string) {
  return db.$transaction(async (tx) => {
    const fund = await findOwnedFund(tx, userId, fundId);
    if (fund.archivedAt) return fund;
    await lockFund(tx, fundId);
    const result = await rebuildFundLedger(tx, fundId);
    if (!result.final.quantity.isZero()) {
      throw new ServiceError(
        "CONFLICT",
        `Não é possível remover ${fund.ticker} com ${result.final.quantity.toFixed()} cota(s) em carteira. Registre a venda ou cancele as operações antes.`,
      );
    }
    const updated = await tx.fund.update({
      where: { id: fundId },
      data: { archivedAt: new Date() },
    });
    await recordAudit(tx, {
      userId,
      entityType: "fund",
      entityId: fundId,
      action: "archive",
    });
    return updated;
  });
}

export async function restoreFund(db: Database, userId: string, fundId: string) {
  return db.$transaction(async (tx) => {
    await findOwnedFund(tx, userId, fundId);
    const updated = await tx.fund.update({
      where: { id: fundId },
      data: { archivedAt: null },
    });
    await recordAudit(tx, {
      userId,
      entityType: "fund",
      entityId: fundId,
      action: "restore",
    });
    return updated;
  });
}

async function insertManualQuote(
  tx: Prisma.TransactionClient,
  userId: string,
  fundId: string,
  quote: ManualQuoteInput,
) {
  const created = await tx.priceQuote.create({
    data: {
      fundId,
      price: quote.price,
      source: "MANUAL",
      referenceDate: quote.referenceDate,
      note: quote.note,
    },
  });
  await recordAudit(tx, {
    userId,
    entityType: "quote",
    entityId: created.id,
    action: "create",
    data: {
      fundId,
      price: quote.price,
      source: "MANUAL",
      referenceDate: quote.referenceDate?.toISOString() ?? null,
    },
  });
  return created;
}

/** Registra uma cotação manual de referência (mantém o histórico das anteriores). */
export async function addManualQuote(
  db: Database,
  userId: string,
  fundId: string,
  input: ManualQuoteFormInput,
) {
  const quote = manualQuoteSchema.parse(input);
  return db.$transaction(async (tx) => {
    await findOwnedFund(tx, userId, fundId);
    return insertManualQuote(tx, userId, fundId, quote);
  });
}

/** Insere o saldo inicial (sem data). Usado na criação ou depois, se ainda não houver. */
export async function insertInitialBalance(
  tx: Prisma.TransactionClient,
  userId: string,
  fundId: string,
  input: InitialBalanceInput,
) {
  const { grossAmount, netAmount } = operationAmounts(
    "INITIAL_BALANCE",
    input.quantity,
    input.averagePrice,
    "0",
  );
  const op = await tx.operation.create({
    data: {
      userId,
      fundId,
      type: "INITIAL_BALANCE",
      tradeDate: null,
      quantity: input.quantity,
      unitPrice: input.averagePrice,
      fees: "0",
      grossAmount: grossAmount.toFixed(2),
      netAmount: netAmount.toFixed(2),
      notes: input.notes,
    },
  });
  await recordAudit(tx, {
    userId,
    entityType: "operation",
    entityId: op.id,
    action: "create",
    data: {
      fundId,
      type: "INITIAL_BALANCE",
      quantity: input.quantity,
      averagePrice: input.averagePrice,
    },
  });
  return op;
}

/** Carteira consolidada. `query` filtra por trecho do ticker. */
export async function getPortfolio(
  db: Database,
  userId: string,
  options: { query?: string; includeArchived?: boolean } = {},
): Promise<PortfolioView> {
  const query = options.query?.trim().toUpperCase();
  const funds = await db.fund.findMany({
    where: {
      userId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
      ...(query ? { ticker: { contains: query } } : {}),
    },
    include: fundWithPositionInclude,
    orderBy: { ticker: "asc" },
  });
  const positions = funds.map(toPositionView);
  return {
    positions,
    totals: computePortfolioTotals(
      positions.filter((p) => !p.archivedAt).map((p) => p.metrics),
    ),
  };
}

export async function getFundByTicker(
  db: Database,
  userId: string,
  rawTicker: string,
): Promise<FundPositionView | null> {
  const parsed = tickerSchema.safeParse(rawTicker);
  if (!parsed.success) return null;
  const fund = await db.fund.findUnique({
    where: { userId_ticker: { userId, ticker: parsed.data } },
    include: fundWithPositionInclude,
  });
  return fund ? toPositionView(fund) : null;
}

export async function listQuotes(
  db: Database,
  userId: string,
  fundId: string,
): Promise<QuoteView[]> {
  await findOwnedFund(db, userId, fundId);
  const quotes = await db.priceQuote.findMany({
    where: { fundId },
    orderBy: { recordedAt: "desc" },
  });
  return quotes.map(toQuoteView);
}

/** Fundos ativos (para seletores de formulário/filtro). */
export async function listFundOptions(db: Database, userId: string) {
  return db.fund.findMany({
    where: { userId },
    select: { id: true, ticker: true, archivedAt: true },
    orderBy: { ticker: "asc" },
  });
}
