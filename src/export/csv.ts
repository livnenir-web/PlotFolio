import type { Sheet } from "../model/types";
import { columnLetter } from "../model/defaults";
import { sheetRowCount } from "../formula/engine";
import { saveTextAs } from "../io/platform";

function esc(v: string, delim: string): string {
  return v.includes(delim) || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
}

export function sheetToCsv(sheet: Sheet, delim = ","): string {
  const n = sheetRowCount(sheet);
  const lines: string[] = [];
  lines.push(sheet.columns.map((c, i) => esc(c.longName.trim() || columnLetter(i), delim)).join(delim));
  if (sheet.columns.some((c) => c.units.trim())) lines.push(sheet.columns.map((c) => esc(c.units, delim)).join(delim));
  for (let r = 0; r < n; r++) {
    lines.push(
      sheet.columns
        .map((c) => {
          const v = c.values[r];
          return v === null || v === undefined ? "" : esc(String(v), delim);
        })
        .join(delim),
    );
  }
  return lines.join("\n") + "\n";
}

export async function exportSheetCsv(sheet: Sheet): Promise<void> {
  await saveTextAs(sheetToCsv(sheet), [{ name: "CSV", extensions: ["csv"] }], `${sheet.name}.csv`);
}
