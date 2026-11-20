/** Falha de um provedor externo, com categoria para tratamento e exibição. */
export type ProviderErrorKind =
  | "NOT_CONFIGURED"
  | "UNAUTHORIZED"
  | "PLAN_RESTRICTED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "INVALID_RESPONSE";

const MESSAGES: Record<ProviderErrorKind, string> = {
  NOT_CONFIGURED: "Provedor não configurado.",
  UNAUTHORIZED: "Chave de API ausente ou inválida.",
  PLAN_RESTRICTED: "O plano contratado não inclui este dado.",
  NOT_FOUND: "Ativo não encontrado no provedor.",
  RATE_LIMITED: "Limite de requisições do provedor atingido.",
  UNAVAILABLE: "Provedor indisponível no momento.",
  TIMEOUT: "O provedor não respondeu a tempo.",
  INVALID_RESPONSE: "Resposta do provedor em formato inesperado.",
};

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    public readonly provider: string,
    detail?: string,
    /** Segundos para tentar de novo (429). */
    public readonly retryAfterSeconds?: number,
  ) {
    super(detail ? `${MESSAGES[kind]} ${detail}` : MESSAGES[kind]);
    this.name = "ProviderError";
  }

  /** Mensagem segura para o usuário (sem detalhes internos). */
  get userMessage() {
    return `${this.provider}: ${MESSAGES[this.kind]}`;
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
