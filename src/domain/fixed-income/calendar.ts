/**
 * Calendário de dias úteis (feriados nacionais/bancários), calculado em código.
 *
 * Feriados considerados (padrão do calendário ANBIMA para o mercado financeiro):
 * - fixos: 01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 25/12;
 * - 20/11 (Dia Nacional de Zumbi e da Consciência Negra) a partir de 2024
 *   (Lei 14.759/2023 — antes não era feriado nacional);
 * - móveis, a partir da Páscoa: Carnaval (segunda e terça), Sexta-feira Santa
 *   e Corpus Christi.
 * Sábados e domingos nunca são dias úteis. Datas no formato "AAAA-MM-DD".
 *
 * Conferido contra as datas efetivamente publicadas na série do CDI (SGS 12)
 * — ver tests/unit/fixed-income-calendar.test.ts.
 */

export type IsoDate = string;

/** Domingo de Páscoa (algoritmo anônimo gregoriano — Meeus/Jones/Butcher). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(new Date(Date.UTC(year, month - 1, day)));
}

export function toIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function fromIso(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = fromIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** Dias corridos de `from` até `to` (to − from). */
export function calendarDaysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((fromIso(to).getTime() - fromIso(from).getTime()) / 86_400_000);
}

const FIXED: { md: string; name: string; since?: number }[] = [
  { md: "01-01", name: "Confraternização Universal" },
  { md: "04-21", name: "Tiradentes" },
  { md: "05-01", name: "Dia do Trabalho" },
  { md: "09-07", name: "Independência do Brasil" },
  { md: "10-12", name: "Nossa Senhora Aparecida" },
  { md: "11-02", name: "Finados" },
  { md: "11-15", name: "Proclamação da República" },
  { md: "11-20", name: "Dia Nacional de Zumbi e da Consciência Negra", since: 2024 },
  { md: "12-25", name: "Natal" },
];

const cache = new Map<number, Map<IsoDate, string>>();

/** Feriados nacionais de um ano: data → nome. */
export function nationalHolidays(year: number): Map<IsoDate, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const map = new Map<IsoDate, string>();
  for (const f of FIXED) {
    if (f.since === undefined || year >= f.since) map.set(`${year}-${f.md}`, f.name);
  }
  const easter = easterSunday(year);
  map.set(addDays(easter, -48), "Carnaval (segunda-feira)");
  map.set(addDays(easter, -47), "Carnaval (terça-feira)");
  map.set(addDays(easter, -2), "Sexta-feira Santa");
  map.set(addDays(easter, 60), "Corpus Christi");
  cache.set(year, map);
  return map;
}

export function isHoliday(iso: IsoDate): boolean {
  return nationalHolidays(Number(iso.slice(0, 4))).has(iso);
}

export function isBusinessDay(iso: IsoDate): boolean {
  const weekday = fromIso(iso).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isHoliday(iso);
}

/** Dias úteis no intervalo [from, to) — `from` incluído, `to` excluído. */
export function businessDaysBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) if (isBusinessDay(d)) out.push(d);
  return out;
}
