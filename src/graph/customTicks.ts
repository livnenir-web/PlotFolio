import type { CustomTick } from "../model/types";

/**
 * Custom tick list as typed in the inspector: items separated by commas, semicolons or new lines, each a value with
 * an optional label after "=", e.g. `0, 3.1416=\pi, 6.2832=2\pi`. Labels may contain markup.
 */
export function parseCustomTicks(text: string): CustomTick[] {
  const out: CustomTick[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const item = raw.trim();
    if (!item) continue;
    const eq = item.indexOf("=");
    const valueText = eq >= 0 ? item.slice(0, eq).trim() : item;
    const label = eq >= 0 ? item.slice(eq + 1).trim() : "";
    const value = Number(valueText.replace(/\s+/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push(label ? { value, label } : { value });
  }
  return out;
}

/** The inverse of parseCustomTicks, for showing the list in the inspector. */
export function formatCustomTicks(ticks: CustomTick[] | undefined): string {
  return (ticks ?? []).map((t) => (t.label ? `${fmt(t.value)}=${t.label}` : fmt(t.value))).join(", ");
}

const fmt = (v: number) => String(Number(v.toPrecision(10)));
