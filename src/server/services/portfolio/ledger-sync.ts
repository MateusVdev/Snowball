import type { Prisma } from "@/generated/prisma/client";
import { roundMoney, roundTo, SCALE, toDecimal } from "@/domain/money";
import { replayLedger, type LedgerResult } from "@/domain/portfolio/ledger";

/**
 * Bloqueia a linha do fundo até o fim da transação. Serializa alterações
 * concorrentes no mesmo fundo (ex.: duas vendas simultâneas).
 */
export async function lockFund(tx: Prisma.TransactionClient, fundId: string) {
  await tx.$queryRaw`SELECT id FROM funds WHERE id = ${fundId} FOR UPDATE`;
}

/**
 * Reprocessa TODAS as operações ativas do fundo e regrava, na mesma
 * transação, os campos derivados das operações e o cache da posição.
 * Lança LedgerError se o histórico ficar inconsistente (ex.: venda acima do
 * saldo) — a transação inteira é desfeita.
 */
export async function rebuildFundLedger(
  tx: Prisma.TransactionClient,
  fundId: string,
): Promise<LedgerResult> {
  const operations = await tx.operation.findMany({
    where: { fundId, status: "ACTIVE" },
    select: {
      id: true,
      type: true,
      tradeDate: true,
      sequence: true,
      quantity: true,
      unitPrice: true,
      fees: true,
    },
  });

  const result = replayLedger(
    operations.map((op) => ({
      ...op,
      quantity: op.quantity.toString(),
      unitPrice: op.unitPrice.toString(),
      fees: op.fees.toString(),
    })),
  );

  for (const step of result.steps) {
    await tx.operation.update({
      where: { id: step.id },
      data: {
        quantityAfter: step.quantityAfter.toFixed(),
        averagePriceAfter: step.averagePriceAfter?.toFixed() ?? null,
        costOfSold: step.costOfSold ? roundMoney(step.costOfSold).toFixed() : null,
        realizedResult: step.realizedResult
          ? roundMoney(step.realizedResult).toFixed()
          : null,
      },
    });
  }

  // Operações inativas não carregam valores derivados.
  await tx.operation.updateMany({
    where: {
      fundId,
      status: { not: "ACTIVE" },
      OR: [{ quantityAfter: { not: null } }, { realizedResult: { not: null } }],
    },
    data: {
      quantityAfter: null,
      averagePriceAfter: null,
      costOfSold: null,
      realizedResult: null,
    },
  });

  const position = {
    quantity: result.final.quantity.toFixed(),
    totalCost: roundTo(result.final.totalCost, 12).toFixed(),
    realizedResult: roundTo(result.final.realizedResult, 12).toFixed(),
  };
  await tx.position.upsert({
    where: { fundId },
    create: { fundId, ...position },
    update: position,
  });

  return result;
}

/** Converte Decimal do Prisma em string para o domínio. */
export function dec(value: Prisma.Decimal | null | undefined) {
  return value == null ? null : toDecimal(value.toString());
}

export { SCALE };
