import { useStore } from "../model/store";
import { newColumn, uid, uniqueName, columnLetter } from "../model/defaults";
import type { CellValue, Column, Sheet } from "../model/types";

/** n, mean, SD, SEM, median, extremes and sum of some numbers (null for none). */
export function describe(values: number[]) {
  const n = values.length;
  if (!n) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { n, mean, sd, sem: sd / Math.sqrt(n), min: sorted[0], max: sorted[n - 1], median, sum };
}

/** Create a "Statistics" sheet for the given columns (all numeric columns when none are selected). */
export function columnStatistics(sheetId: string, colIndices: number[]): void {
  const st = useStore.getState();
  const sheet = st.project.sheets.find((s) => s.id === sheetId);
  if (!sheet) return;
  const idx = colIndices.length ? colIndices : sheet.columns.map((_, i) => i);
  statisticsSheet(sheet.name, idx.filter((i) => sheet.columns[i]).map((i) => ({ name: sheet.columns[i].longName || columnLetter(i), values: sheet.columns[i].values })));
}

/** Create a "Statistics of …" sheet with one row per named set of values (those without numbers are left out). */
export function statisticsSheet(of: string, sets: { name: string; values: CellValue[] }[]): void {
  const st = useStore.getState();
  const rows: { name: string; stats: NonNullable<ReturnType<typeof describe>> }[] = [];
  for (const set of sets) {
    const s = describe(set.values.filter((v): v is number => typeof v === "number"));
    if (s) rows.push({ name: set.name, stats: s });
  }
  if (!rows.length) return;
  const mk = (name: string, d: Column["designation"], vals: Column["values"]): Column => {
    const c = newColumn(d);
    c.longName = name;
    c.values = vals;
    return c;
  };
  const r = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(8)) : null);
  const out: Sheet = {
    id: uid(),
    name: uniqueName(`Statistics of ${of}`, st.project.sheets.map((s) => s.name)),
    columns: [
      mk("Column", "label", rows.map((x) => x.name)),
      mk("N", "none", rows.map((x) => x.stats.n)),
      mk("Mean", "Y", rows.map((x) => r(x.stats.mean))),
      mk("SD", "yErr", rows.map((x) => r(x.stats.sd))),
      mk("SEM", "none", rows.map((x) => r(x.stats.sem))),
      mk("Median", "none", rows.map((x) => r(x.stats.median))),
      mk("Min", "none", rows.map((x) => r(x.stats.min))),
      mk("Max", "none", rows.map((x) => r(x.stats.max))),
      mk("Sum", "none", rows.map((x) => r(x.stats.sum))),
    ],
  };
  st.addSheetObject(out);
}
