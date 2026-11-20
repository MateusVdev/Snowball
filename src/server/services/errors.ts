import { Prisma } from "@/generated/prisma/client";
import { LedgerError } from "@/domain/portfolio/ledger";

/**
 * Erro de regra de negócio com mensagem segura para exibir ao usuário.
 * Qualquer outro erro é tratado como falha inesperada (mensagem genérica).
 */
export type ServiceErrorCode = "NOT_FOUND" | "CONFLICT" | "INVALID";

export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/** Converte erros conhecidos (ledger, unicidade) em ServiceError. */
export function toServiceError(error: unknown): ServiceError | null {
  if (error instanceof ServiceError) return error;
  if (error instanceof LedgerError) {
    return new ServiceError("INVALID", error.message);
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return new ServiceError("CONFLICT", "Registro duplicado.");
  }
  return null;
}
