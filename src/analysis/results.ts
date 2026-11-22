// Small helpers shared by the commands that write their results as new columns beside the data.

import type { CellValue } from "../model/types";

/** Do the cells of a column hold exactly these numbers, row for row (trailing empty cells aside)? */
export function sameNumbers(cells: CellValue[], values: number[]): boolean {
  let n = cells.length;
  while (n > 0 && (cells[n - 1] === null || cells[n - 1] === "")) n--;
  if (n !== values.length) return false;
  for (let i = 0; i < n; i++) if (cells[i] !== values[i]) return false;
  return true;
}

/** What an average is "of" in a column title: the names of up to three curves, or their number. */
export function averageNames(names: string[]): string {
  if (names.length <= 3 && names.every((n) => n.trim())) return names.length === 2 ? `${names[0]} and ${names[1]}` : names.join(", ");
  return `${names.length} curves`;
}
