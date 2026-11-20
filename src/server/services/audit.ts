import type { Prisma } from "@/generated/prisma/client";

export type AuditEntity = "fund" | "operation" | "quote" | "dividend";

/** Registra um evento na trilha de auditoria (tabela somente-inserção). */
export async function recordAudit(
  tx: Prisma.TransactionClient,
  event: {
    userId: string;
    entityType: AuditEntity;
    entityId: string;
    action: string;
    data?: Prisma.InputJsonValue;
  },
) {
  await tx.auditEvent.create({ data: event });
}
