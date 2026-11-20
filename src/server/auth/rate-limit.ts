/**
 * Política de limitação de tentativas de login (anti força bruta).
 * Lógica pura — as contagens vêm do banco (tabela login_attempts).
 */
export const LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  maxFailuresPerEmail: 5,
  maxFailuresPerIp: 20,
} as const;

export interface FailureCounts {
  byEmail: number;
  byIp: number;
}

export function isLoginRateLimited(
  counts: FailureCounts,
  policy: typeof LOGIN_RATE_LIMIT = LOGIN_RATE_LIMIT,
): boolean {
  return (
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
