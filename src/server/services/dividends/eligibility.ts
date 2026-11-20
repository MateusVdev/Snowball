import type { Database } from "@/server/db/factory";
import type { Prisma } from "@/generated/prisma/client";
import { parseIsoDate, todayIsoDate } from "@/domain/dates";
import { eligibleQuantityAt, type Eligibility } from "@/domain/dividends";
import type { LedgerOperationInput } from "@/domain/portfolio/ledger";

/**
 * Carrega o necessário para calcular a quantidade elegível de um fundo em
 * qualquer data-com: operações ativas e a data em que o saldo inicial passou
 * a ser conhecido (primeiro registro, em São Paulo).
 */
export interface FundLedgerSnapshot {
  operations: LedgerOperationInput[];
  initialBalanceKnownSince: Date | null;
}

export async function loadFundLedgers(
  db: Database | Prisma.TransactionClient,
  fundIds: string[],
): Promise<Map<string, FundLedgerSnapshot>> {
  const ops = await db.operation.findMany({
    where: { fundId: { in: fundIds } },
    select: {
      id: true,
      fundId: true,
      type: true,
      status: true,
      tradeDate: true,
      sequence: true,
      quantity: true,
      unitPrice: true,
      fees: true,
      createdAt: true,
    },
  });
  const map = new Map<string, FundLedgerSnapshot>();
  for (const id of fundIds) map.set(id, { operations: [], initialBalanceKnownSince: null });
  for (const op of ops) {
    const snap = map.get(op.fundId)!;
    if (op.type === "INITIAL_BALANCE") {
      // Saldo conhecido desde o PRIMEIRO registro (mesmo se depois corrigido).
      const known = parseIsoDate(todayIsoDate(op.createdAt))!;
      if (!snap.initialBalanceKnownSince || known < snap.initialBalanceKnownSince) {
        snap.initialBalanceKnownSince = known;
      }
    }
    if (op.status !== "ACTIVE") continue;
    snap.operations.push({
      id: op.id,
      type: op.type,
      tradeDate: op.tradeDate,
      sequence: op.sequence,
      quantity: op.quantity.toString(),
      unitPrice: op.unitPrice.toString(),
      fees: op.fees.toString(),
    });
  }
  return map;
}

export function eligibilityFor(snapshot: FundLedgerSnapshot | undefined, dataCom: Date): Eligibility {
  if (!snapshot) return { status: "UNKNOWN", reason: "Fundo sem histórico." };
  return eligibleQuantityAt(snapshot.operations, dataCom, snapshot.initialBalanceKnownSince);
}
