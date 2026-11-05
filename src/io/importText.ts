import Papa from "papaparse";
import type { CellValue, Column, Designation, Sheet } from "../model/types";
import { newColumn, uid } from "../model/defaults";

export interface TextImportOptions {
  delimiter: "auto" | "," | "\t" | ";" | " " | "|";
  /** 1-based header row index, 0 = no header row */
  headerRow: number;
  /** 1-based row that contains units, 0 = none */
  unitsRow: number;
  /** 1-based first data row */
  firstDataRow: number;
  decimalComma: boolean;
  skipEmptyLines: boolean;
}

export const defaultTextImportOptions: TextImportOptions = {
  delimiter: "auto",
  headerRow: 1,
  unitsRow: 0,
  firstDataRow: 2,
  decimalComma: false,
  skipEmptyLines: true,
};

export interface ParsedTable {
  rows: string[][];
  delimiter: string;
}

export function parseDelimited(text: string, delimiter: TextImportOptions["delimiter"]): ParsedTable {
  const clean = text.replace(/^﻿/, "");
  const res = Papa.parse<string[]>(clean, {
    delimiter: delimiter === "auto" ? "" : delimiter,
    delimitersToGuess: [",", "\t", ";", "|", " "],
    skipEmptyLines: "greedy",
  });
  let rows = res.data.map((r) => r.map((c) => (c ?? "").toString()));
  if (delimiter === " ") {
    // collapse runs of whitespace
    rows = clean
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .map((l) => l.trim().split(/\s+/));
  }
  return { rows, delimiter: res.meta.delimiter };
}

/** Heuristic: does the first row look like a header? */
export function looksLikeHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const first = rows[0];
  const second = rows[1];
  const numeric = (s: string) => s.trim() !== "" && Number.isFinite(Number(s.trim().replace(",", ".")));
  const firstNumeric = first.filter(numeric).length;
  const secondNumeric = second.filter(numeric).length;
  return firstNumeric < secondNumeric;
}

export function guessOptions(text: string): TextImportOptions {
  const { rows } = parseDelimited(text, "auto");
  const header = looksLikeHeader(rows);
  let unitsRow = 0;
  if (header && rows.length > 2) {
    // a second non-numeric row is probably units
    const numeric = (s: string) => s.trim() !== "" && Number.isFinite(Number(s.trim().replace(",", ".")));
    const secondNumeric = rows[1].filter(numeric).length;
    const thirdNumeric = rows[2].filter(numeric).length;
    if (secondNumeric === 0 && thirdNumeric > 0) unitsRow = 2;
  }
  return {
    ...defaultTextImportOptions,
    headerRow: header ? 1 : 0,
    unitsRow,
    firstDataRow: header ? (unitsRow ? 3 : 2) : 1,
  };
}

export function toCell(raw: string, decimalComma: boolean): CellValue {
  const s = raw.trim();
  if (s === "" || s === "NaN" || s === "nan" || s === "NA" || s === "--") return null;
  const t = decimalComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : s;
}

export function defaultDesignations(count: number): Designation[] {
  return Array.from({ length: count }, (_, i) => (i === 0 ? "X" : "Y"));
}

export function tableToSheet(rows: string[][], opts: TextImportOptions, name: string): Sheet {
  const nCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const header = opts.headerRow > 0 ? rows[opts.headerRow - 1] ?? [] : [];
  const units = opts.unitsRow > 0 ? rows[opts.unitsRow - 1] ?? [] : [];
  const data = rows.slice(Math.max(0, opts.firstDataRow - 1));
  const designations = defaultDesignations(nCols);
  const columns: Column[] = [];
  for (let c = 0; c < nCols; c++) {
    const col = newColumn(designations[c]);
    let longName = (header[c] ?? "").trim();
    let unit = (units[c] ?? "").trim();
    // "Time (s)" or "Voltage [mV]" → name + units
    const m = /^(.*\S)\s*[(\[]([^()\[\]]{1,12})[)\]]\s*$/.exec(longName);
    if (m && !unit) {
      longName = m[1];
      unit = m[2];
    }
    col.longName = longName;
    col.units = unit;
    col.values = data.map((r) => toCell(r[c] ?? "", opts.decimalComma));
    columns.push(col);
  }
  return { id: uid(), name, columns };
}

/** Parse clipboard text (TSV from Excel/Numbers, or CSV) into a 2-D string array. */
export function parseClipboard(text: string): string[][] {
  const delim = text.includes("\t") ? "\t" : "auto";
  return parseDelimited(text, delim).rows;
}
