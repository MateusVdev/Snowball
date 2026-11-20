/**
 * Regras de atualidade das cotações (puras).
 *
 * "Idade útil" = tempo decorrido sem contar sábados e domingos (no fuso de
 * São Paulo, UTC−3 fixo desde 2019). Feriados não são considerados: em
 * feriados uma cotação pode aparecer como desatualizada (aviso conservador).
 */
const SAO_PAULO_OFFSET_MS = -3 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** Milissegundos úteis (seg–sex, horário de São Paulo) entre dois instantes. */
export function businessMsBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let total = 0;
  let cursor = from.getTime() + SAO_PAULO_OFFSET_MS;
  const end = to.getTime() + SAO_PAULO_OFFSET_MS;
  while (cursor < end) {
    const dayStart = Math.floor(cursor / DAY_MS) * DAY_MS;
    const dayEnd = Math.min(dayStart + DAY_MS, end);
    const weekday = new Date(dayStart).getUTCDay();
    if (weekday !== 0 && weekday !== 6) total += dayEnd - cursor;
    cursor = dayEnd;
  }
  return total;
}

export interface QuoteFreshnessInput {
  source: "MANUAL" | "BRAPI" | "BRAPI_DAILY_CLOSE";
  /** Instante a que o preço se refere, segundo o provedor. */
  marketTime: Date | null;
  /** Data de referência informada (cotação manual). */
  referenceDate: Date | null;
  recordedAt: Date;
}

/** Instante a que a cotação efetivamente se refere. */
export function quoteAsOf(q: QuoteFreshnessInput): Date {
  if (q.marketTime) return q.marketTime;
  if (q.referenceDate) {
    // Fim do pregão do dia de referência (18h em São Paulo = 21h UTC).
    return new Date(q.referenceDate.getTime() + 21 * 3600 * 1000);
  }
  return q.recordedAt;
}

/** Desatualizada se a idade útil passar do limite (em horas úteis). */
export function isQuoteStale(
  q: QuoteFreshnessInput,
  now: Date,
  maxBusinessHours: number,
): boolean {
  return businessMsBetween(quoteAsOf(q), now) > maxBusinessHours * 3600 * 1000;
}
