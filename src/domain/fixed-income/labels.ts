import { toDecimal, type DecimalInput } from "@/domain/money";

/** Rótulos de exibição da renda fixa (puro; servidor e cliente). */

export const PRODUCT_TYPE_LABEL: Record<string, string> = {
  CDB: "CDB",
  RDB: "RDB",
  LCI: "LCI",
  LCA: "LCA",
  TESOURO_SELIC: "Tesouro Selic",
  OUTRO: "Outro",
  PREFIXADO: "Prefixado",
  TESOURO_IPCA: "Tesouro IPCA+",
};

export const INDEXER_LABEL: Record<string, string> = { CDI: "CDI", SELIC: "Selic", PRE: "Prefixado", IPCA: "IPCA" };

function pt(value: DecimalInput) {
  return toDecimal(value).toFixed().replace(".", ",");
}

/** "115% do CDI", "100% da Selic + 0,1% a.a." */
export function rateLabel(rate: DecimalInput, indexer: string, spreadAnnualPercent: DecimalInput | null = null) {
  const base = `${pt(rate)}% ${indexer === "SELIC" ? "da" : "do"} ${INDEXER_LABEL[indexer] ?? indexer}`;
  if (spreadAnnualPercent === null || toDecimal(spreadAnnualPercent).isZero()) return base;
  const s = toDecimal(spreadAnnualPercent);
  return `${base} ${s.isNegative() ? "−" : "+"} ${pt(s.abs())}% a.a.`;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2025-03" → "mar/25" */
export function monthLabel(month: string) {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]}/${month.slice(2, 4)}`;
}

/** "2025-03-10" → "10/03/2025" */
export function isoToBr(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
