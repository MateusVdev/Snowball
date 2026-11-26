/**
 * Política de limitação de tentativas de login (anti força bruta).
 * Lógica pura — as contagens vêm do banco (tabela login_attempts).
 *
 * Três dimensões, na mesma janela:
 * - mesmo e-mail a partir do mesmo IP: limite baixo (força bruta comum);
 * - mesmo e-mail somando todos os IPs: limite maior, contra força bruta
 *   distribuída — sem permitir que alguém, de um único IP, bloqueie o dono da
 *   conta (o bloqueio de um IP não afeta os outros IPs);
 * - mesmo IP somando todos os e-mails: contra varredura de contas.
 * Tentativas EM ANDAMENTO também contam (ver `login` em service.ts): a
 * tentativa é registrada como falha antes da conferência da senha.
 */
export const LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  maxFailuresPerEmailAndIp: 5,
  maxFailuresPerEmail: 30,
  maxFailuresPerIp: 20,
} as const;

export interface FailureCounts {
  byEmail: number;
  byIp: number;
  /** Falhas do mesmo e-mail a partir do mesmo IP (= byEmail quando o IP é desconhecido). */
  byEmailAndIp?: number;
}

export function isLoginRateLimited(
  counts: FailureCounts,
  policy: typeof LOGIN_RATE_LIMIT = LOGIN_RATE_LIMIT,
): boolean {
  return (
    (counts.byEmailAndIp ?? counts.byEmail) >= policy.maxFailuresPerEmailAndIp ||
    counts.byEmail >= policy.maxFailuresPerEmail ||
    counts.byIp >= policy.maxFailuresPerIp
  );
}

export function rateLimitWindowStart(
  now: Date,
  policy: typeof LOGIN_RATE_LIMIT = LOGIN_RATE_LIMIT,
): Date {
  return new Date(now.getTime() - policy.windowMs);
}
