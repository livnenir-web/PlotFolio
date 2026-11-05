import * as XLSX from "xlsx";

export interface XlsxWorkbook {
  sheetNames: string[];
  /** Returns the worksheet as a 2-D array of strings (numbers formatted with full precision). */
  table: (sheetName: string) => string[][];
}

export function readWorkbook(data: Uint8Array): XlsxWorkbook {
  const wb = XLSX.read(data, { type: "array", cellDates: false });
  return {
    sheetNames: wb.SheetNames,
    table: (name) => {
      const ws = wb.Sheets[name];
      if (!ws) return [];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
      return aoa.map((row) => row.map((v) => (v === null || v === undefined ? "" : typeof v === "number" ? String(v) : String(v))));
    },
  };
}
