/**
 * Datas "de calendário" (sem horário), como a data de um pregão.
 * Representadas como Date à meia-noite UTC, compatíveis com colunas `@db.Date`.
 * O "hoje" de referência é o do fuso de São Paulo (B3).
 */
export const MARKET_TIME_ZONE = "America/Sao_Paulo";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-03-15" → Date(2026-03-15T00:00:00Z). Retorna null se inválida. */
export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

/** Date (meia-noite UTC) → "2026-03-15". */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Data de hoje em São Paulo, como "YYYY-MM-DD". */
export function todayIsoDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Formata uma data de calendário como "15/03/2026". */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

/** Formata um instante (timestamp) no fuso de São Paulo: "15/03/2026 14:05". */
export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: MARKET_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
