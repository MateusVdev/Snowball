import type { Database } from "@/server/db/factory";
import { Prisma } from "@/generated/prisma/client";
import { toIsoDate, todayIsoDate } from "@/domain/dates";
import {
  dividendAmount,
  dividendEventStatus,
  dividendYield12m,
  summarizeIncome,
  type DividendEventStatus,
  type DividendYieldResult,
  type Eligibility,
  type IncomeSummary,
} from "@/domain/dividends";
import type { FinDecimal } from "@/domain/money";
import {
  dividendEventSchema,
  receiptSchema,
  type DividendEventFormInput,
  type ReceiptFormInput,
} from "@/validation/dividends";
import { reasonSchema } from "@/validation/portfolio";
import { recordAudit } from "../audit";
import { ServiceError } from "../errors";
import { eligibilityFor, loadFundLedgers } from "./eligibility";

/**
 * Proventos: eventos (anunciado / pago / previsto) e recebimentos
 * ("recebido e registrado"). Nada é excluído: anular exige motivo.
 */

export interface DividendEventView {
  id: string;
  fundId: string;
  ticker: string;
  kind: "OFFICIAL" | "FORECAST";
  type: "INCOME" | "AMORTIZATION";
  source: "MANUAL" | "BRAPI" | "B3_FUNDOSNET";
  ratePerShare: string;
  dataCom: Date;
  paymentDate: Date | null;
  approvedOn: Date | null;
  competence: string | null;
  referenceLabel: string | null;
  verified: boolean | null;
  notes: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  status: DividendEventStatus;
  eligibility: Eligibility;
  /** round2(quantidade elegível × valor) quando a elegibilidade é conhecida. */
  expectedAmount: FinDecimal | null;
  receipt: ReceiptView | null;
}

export interface ReceiptView {
  id: string;
  eventId: string;
  fundId: string;
  ticker: string;
  type: "INCOME" | "AMORTIZATION";
  eligibleQuantity: string;
  quantitySource: "LEDGER" | "MANUAL";
  ratePerShare: string;
  totalAmount: string;
  paymentDate: Date;
  notes: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
}

const eventInclude = {
  fund: { select: { ticker: true } },
  receipts: { include: { fund: { select: { ticker: true } } }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.DividendEventInclude;

type EventRow = Prisma.DividendEventGetPayload<{ include: typeof eventInclude }>;
type ReceiptRow = EventRow["receipts"][number];

function toReceiptView(r: ReceiptRow, type: "INCOME" | "AMORTIZATION"): ReceiptView {
  return {
    id: r.id,
    eventId: r.eventId,
    fundId: r.fundId,
    ticker: r.fund.ticker,
    type,
    eligibleQuantity: r.eligibleQuantity.toString(),
    quantitySource: r.quantitySource,
    ratePerShare: r.ratePerShare.toString(),
    totalAmount: r.totalAmount.toString(),
    paymentDate: r.paymentDate,
    notes: r.notes,
    voidedAt: r.voidedAt,
    voidReason: r.voidReason,
    createdAt: r.createdAt,
  };
}

async function toEventViews(db: Database, rows: EventRow[], todayIso: string): Promise<DividendEventView[]> {
  const ledgers = await loadFundLedgers(db, [...new Set(rows.map((r) => r.fundId))]);
  return rows.map((e) => {
    const eligibility = eligibilityFor(ledgers.get(e.fundId), e.dataCom);
    const activeReceipt = e.receipts.find((r) => !r.voidedAt) ?? null;
    return {
      id: e.id,
      fundId: e.fundId,
      ticker: e.fund.ticker,
      kind: e.kind,
      type: e.type,
      source: e.source,
      ratePerShare: e.ratePerShare.toString(),
      dataCom: e.dataCom,
      paymentDate: e.paymentDate,
      approvedOn: e.approvedOn,
      competence: e.competence,
      referenceLabel: e.referenceLabel,
      verified: e.verified,
      notes: e.notes,
      voidedAt: e.voidedAt,
      voidReason: e.voidReason,
      createdAt: e.createdAt,
      status: dividendEventStatus(e, todayIso),
      eligibility,
      expectedAmount:
        eligibility.status === "KNOWN" && eligibility.quantity.gt(0)
          ? dividendAmount(eligibility.quantity, e.ratePerShare.toString())
          : null,
      receipt: activeReceipt ? toReceiptView(activeReceipt, e.type) : null,
    };
  });
}

async function findOwnedFund(db: Database | Prisma.TransactionClient, userId: string, fundId: string) {
  const fund = await db.fund.findFirst({ where: { id: fundId, userId } });
  if (!fund) throw new ServiceError("NOT_FOUND", "Fundo não encontrado.");
  return fund;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Cadastro manual de provento oficial (anunciado/pago) ou de previsão. */
export async function registerDividendEvent(db: Database, userId: string, input: DividendEventFormInput) {
  const data = dividendEventSchema.parse(input);
  await findOwnedFund(db, userId, data.fundId);
  try {
    return await db.$transaction(async (tx) => {
      const event = await tx.dividendEvent.create({
        data: {
          userId,
          fundId: data.fundId,
          kind: data.kind,
          type: data.type,
          source: "MANUAL",
          ratePerShare: data.ratePerShare,
          dataCom: data.dataCom,
          paymentDate: data.paymentDate,
          competence: data.competence,
          referenceLabel: data.competence,
          notes: data.notes,
        },
      });
      await recordAudit(tx, {
        userId,
        entityType: "dividend",
        entityId: event.id,
        action: "create",
        data: { kind: data.kind, type: data.type, ratePerShare: data.ratePerShare, dataCom: toIsoDate(data.dataCom), paymentDate: data.paymentDate ? toIsoDate(data.paymentDate) : null, source: "MANUAL" },
      });
      return event;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ServiceError("CONFLICT", "Já existe um provento igual (mesmo fundo, tipo, data-com e pagamento). Duplicidade evitada.");
    }
    throw error;
  }
}

export async function voidDividendEvent(db: Database, userId: string, eventId: string, rawReason: string) {
  const reason = reasonSchema.parse(rawReason);
  return db.$transaction(async (tx) => {
    const event = await tx.dividendEvent.findFirst({ where: { id: eventId, userId } });
    if (!event) throw new ServiceError("NOT_FOUND", "Provento não encontrado.");
    if (event.voidedAt) throw new ServiceError("CONFLICT", "Este provento já foi anulado.");
    const active = await tx.dividendReceipt.count({ where: { eventId, voidedAt: null } });
    if (active > 0) {
      throw new ServiceError("CONFLICT", "Há um recebimento registrado para este provento. Anule o recebimento antes.");
    }
    await tx.dividendEvent.update({ where: { id: eventId }, data: { voidedAt: new Date(), voidReason: reason } });
    await recordAudit(tx, { userId, entityType: "dividend", entityId: eventId, action: "void", data: { reason } });
  });
}

/**
 * Registra o recebimento ("recebido e registrado") de um provento oficial já
 * pago. Quantidade: a elegível pelo histórico na data-com; se desconhecida ou
 * diferente, o usuário informa (origem MANUAL). Um recebimento ativo por evento.
 */
export async function confirmReceipt(
  db: Database,
  userId: string,
  eventId: string,
  input: ReceiptFormInput = {},
  todayIso = todayIsoDate(),
) {
  const data = receiptSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const event = await tx.dividendEvent.findFirst({ where: { id: eventId, userId }, include: { fund: true } });
      if (!event) throw new ServiceError("NOT_FOUND", "Provento não encontrado.");
      if (event.voidedAt) throw new ServiceError("CONFLICT", "Provento anulado.");
      if (event.kind !== "OFFICIAL") {
        throw new ServiceError("INVALID", "Previsões não podem ser registradas como recebidas. Registre o provento oficial.");
      }
      if (!event.paymentDate || toIsoDate(event.paymentDate) > todayIso) {
        throw new ServiceError("INVALID", "O pagamento ainda não ocorreu.");
      }
      let quantity: string;
      let quantitySource: "LEDGER" | "MANUAL";
      if (data.quantity) {
        quantity = data.quantity;
        quantitySource = "MANUAL";
      } else {
        const ledgers = await loadFundLedgers(tx, [event.fundId]);
        const eligibility = eligibilityFor(ledgers.get(event.fundId), event.dataCom);
        if (eligibility.status === "UNKNOWN") {
          throw new ServiceError("INVALID", `Quantidade elegível desconhecida: ${eligibility.reason} Informe a quantidade que você tinha na data-com.`);
        }
        if (eligibility.quantity.lte(0)) {
          throw new ServiceError("INVALID", "Sem cotas na data-com: não há provento a receber.");
        }
        quantity = eligibility.quantity.toFixed();
        quantitySource = "LEDGER";
      }
      const rate = event.ratePerShare.toString();
      const total = dividendAmount(quantity, rate);
      const receipt = await tx.dividendReceipt.create({
        data: {
          userId,
          fundId: event.fundId,
          eventId: event.id,
          eligibleQuantity: quantity,
          quantitySource,
          ratePerShare: rate,
          totalAmount: total.toFixed(2),
          paymentDate: event.paymentDate,
          notes: data.notes,
        },
      });
      await recordAudit(tx, {
        userId,
        entityType: "dividend",
        entityId: event.id,
        action: "receive",
        data: { receiptId: receipt.id, quantity, quantitySource, totalAmount: total.toFixed(2) },
      });
      return receipt;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ServiceError("CONFLICT", "Este provento já tem um recebimento registrado. Pagamento duplicado evitado.");
    }
    throw error;
  }
}

export async function voidReceipt(db: Database, userId: string, receiptId: string, rawReason: string) {
  const reason = reasonSchema.parse(rawReason);
  return db.$transaction(async (tx) => {
    const receipt = await tx.dividendReceipt.findFirst({ where: { id: receiptId, userId } });
    if (!receipt) throw new ServiceError("NOT_FOUND", "Recebimento não encontrado.");
    if (receipt.voidedAt) throw new ServiceError("CONFLICT", "Recebimento já anulado.");
    await tx.dividendReceipt.update({ where: { id: receiptId }, data: { voidedAt: new Date(), voidReason: reason } });
    await recordAudit(tx, { userId, entityType: "dividend", entityId: receipt.eventId, action: "void_receipt", data: { receiptId, reason } });
  });
}

/**
 * Registra de uma vez os recebimentos de proventos oficiais já pagos cuja
 * quantidade elegível é conhecida pelo histórico. Os de elegibilidade
 * desconhecida ficam pendentes para confirmação individual.
 */
export async function confirmPendingReceipts(db: Database, userId: string, todayIso = todayIsoDate()) {
  const overview = await listDividendEvents(db, userId, { todayIso });
  let created = 0;
  let unknown = 0;
  for (const e of overview) {
    if (e.status !== "PAID" || e.receipt || e.voidedAt) continue;
    if (e.eligibility.status === "UNKNOWN") {
      unknown += 1;
      continue;
    }
    if (e.eligibility.quantity.lte(0)) continue;
    try {
      await confirmReceipt(db, userId, e.id, {}, todayIso);
      created += 1;
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
    }
  }
  return { created, unknown };
}

export async function listDividendEvents(
  db: Database,
  userId: string,
  options: { todayIso?: string; fundId?: string; includeVoided?: boolean; from?: Date; to?: Date } = {},
): Promise<DividendEventView[]> {
  const rows = await db.dividendEvent.findMany({
    where: {
      userId,
      ...(options.fundId ? { fundId: options.fundId } : {}),
      ...(options.includeVoided ? {} : { voidedAt: null }),
      ...(options.from || options.to
        ? { dataCom: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lte: options.to } : {}) } }
        : {}),
    },
    include: eventInclude,
    orderBy: [{ dataCom: "desc" }, { createdAt: "desc" }],
  });
  return toEventViews(db, rows, options.todayIso ?? todayIsoDate());
}

export async function getDividendEvent(db: Database, userId: string, eventId: string, todayIso = todayIsoDate()) {
  const row = await db.dividendEvent.findFirst({ where: { id: eventId, userId }, include: eventInclude });
  if (!row) return null;
  const [view] = await toEventViews(db, [row], todayIso);
  const receipts = row.receipts.map((r) => toReceiptView(r, row.type));
  return { event: view, receipts };
}

export interface UpcomingPayment {
  fundId: string;
  ticker: string;
  /** Anúncio oficial com pagamento futuro (ou sem data), se houver. */
  announced: DividendEventView[];
  /** Previsões do usuário ainda sem anúncio oficial correspondente. */
  forecasts: DividendEventView[];
}

export interface DividendsOverview {
  todayIso: string;
  events: DividendEventView[];
  receipts: ReceiptView[];
  income: IncomeSummary;
  upcoming: UpcomingPayment[];
  /** Pagos pelo fundo, sem recebimento registrado. */
  pending: DividendEventView[];
  yields: { fundId: string; ticker: string; result: DividendYieldResult }[];
}

export async function getDividendsOverview(
  db: Database,
  userId: string,
  options: { todayIso?: string; prices?: Map<string, { price: string | null; averagePrice: string | null }> } = {},
): Promise<DividendsOverview> {
  const todayIso = options.todayIso ?? todayIsoDate();
  const [events, receiptRows, funds] = await Promise.all([
    listDividendEvents(db, userId, { todayIso }),
    db.dividendReceipt.findMany({
      where: { userId, voidedAt: null },
      include: { fund: { select: { ticker: true } }, event: { select: { type: true } } },
      orderBy: { paymentDate: "desc" },
    }),
    db.fund.findMany({ where: { userId, archivedAt: null }, select: { id: true, ticker: true }, orderBy: { ticker: "asc" } }),
  ]);

  const receipts = receiptRows.map((r) => toReceiptView(r, r.event.type));
  const income = summarizeIncome(
    receipts.map((r) => ({ fundId: r.fundId, ticker: r.ticker, type: r.type, paymentDate: r.paymentDate, totalAmount: r.totalAmount })),
    todayIso,
  );

  const upcoming: UpcomingPayment[] = funds.map((f) => {
    const fundEvents = events.filter((e) => e.fundId === f.id);
    const announced = fundEvents.filter((e) => e.status === "ANNOUNCED");
    const officialCompetences = new Set(fundEvents.filter((e) => e.kind === "OFFICIAL").map((e) => e.competence).filter(Boolean));
    const forecasts = fundEvents.filter(
      (e) =>
        e.status === "FORECAST" &&
        !(e.competence && officialCompetences.has(e.competence)) &&
        (!e.paymentDate || toIsoDate(e.paymentDate) >= todayIso),
    );
    return { fundId: f.id, ticker: f.ticker, announced, forecasts };
  });

  const pending = events.filter((e) => e.status === "PAID" && !e.receipt);

  const yields = funds.map((f) => {
    const p = options.prices?.get(f.id);
    return {
      fundId: f.id,
      ticker: f.ticker,
      result: dividendYield12m(
        events.filter((e) => e.fundId === f.id),
        p?.price ?? null,
        p?.averagePrice ?? null,
        todayIso,
      ),
    };
  });

  return { todayIso, events, receipts, income, upcoming, pending, yields };
}

