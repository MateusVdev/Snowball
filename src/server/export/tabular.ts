import { strToU8, zipSync } from "fflate";

/**
 * Exportação tabular sem dependências pesadas.
 * - CSV: UTF-8 com BOM, separador ";" e decimal com vírgula (abre direto no
 *   Excel em pt-BR). Textos que começam com = + - @ recebem apóstrofo
 *   (proteção contra injeção de fórmulas).
 * - XLSX: OOXML mínimo (uma planilha por conjunto), números como números.
 */
export type Cell = { t: "s"; v: string | null } | { t: "n"; v: string | null } | { t: "d"; v: string | null };

export interface Dataset {
  name: string;
  columns: string[];
  rows: Cell[][];
}

export const text = (v: string | null | undefined): Cell => ({ t: "s", v: v ?? null });
export const num = (v: string | number | null | undefined): Cell => ({ t: "n", v: v === null || v === undefined ? null : String(v) });
/** Data de calendário "AAAA-MM-DD" ou instante ISO. */
export const date = (v: Date | null | undefined, withTime = false): Cell => ({
  t: "d",
  v: v ? (withTime ? v.toISOString() : v.toISOString().slice(0, 10)) : null,
});

function csvValue(cell: Cell): string {
  if (cell.v === null) return "";
  let s = cell.t === "n" ? cell.v.replace(".", ",") : cell.v;
  if (cell.t === "s" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(ds: Dataset): string {
  const lines = [ds.columns.map((c) => csvValue(text(c))).join(";"), ...ds.rows.map((r) => r.map(csvValue).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

function xmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function colName(i: number) {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(ds: Dataset) {
  const row = (cells: Cell[], r: number) =>
    `<row r="${r}">${cells
      .map((c, i) => {
        const ref = `${colName(i)}${r}`;
        if (c.v === null) return "";
        if (c.t === "n" && /^-?\d+(\.\d+)?$/.test(c.v)) return `<c r="${ref}"><v>${c.v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${r === 1 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEscape(c.v)}</t></is></c>`;
      })
      .join("")}</row>`;
  const rows = [row(ds.columns.map((c) => text(c)), 1), ...ds.rows.map((r, i) => row(r, i + 2))].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows}</sheetData></worksheet>`;
}

function sheetName(name: string, used: Set<string>) {
  const base = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Planilha";
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 28)} ${i}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function toXlsx(datasets: Dataset[]): Uint8Array {
  const used = new Set<string>();
  const names = datasets.map((d) => sheetName(d.name, used));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${datasets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("")}</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${datasets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}<Relationship Id="rId${datasets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    ),
  };
  datasets.forEach((d, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(d));
  });
  return zipSync(files, { level: 6 });
}
