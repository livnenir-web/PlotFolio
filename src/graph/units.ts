import type { TextStyle } from "../model/types";

export const PT_PER_MM = 72 / 25.4;
export const MM_PER_PT = 25.4 / 72;
export const PX_PER_MM_96 = 96 / 25.4;

export const ptToMm = (pt: number) => pt * MM_PER_PT;
export const mmToPt = (mm: number) => mm * PT_PER_MM;

export function fontCss(style: TextStyle, pxPerMm = 1): string {
  const sizePx = ptToMm(style.sizePt) * pxPerMm;
  return `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${sizePx}px ${quoteFont(style.font)}`;
}

export function quoteFont(font: string): string {
  const fam = font.includes(" ") ? `"${font}"` : font;
  return `${fam}, Helvetica, Arial, sans-serif`;
}

let ctx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D | null {
  if (ctx) return ctx;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  ctx = c.getContext("2d");
  return ctx;
}

// Text measurement is cached by font + text. Fonts that finish loading later change the metrics, so the
// cache is cleared (and `fontGeneration` bumped, which invalidates the layout caches) when that happens.
const measureCache = new Map<string, number>();
const MEASURE_CACHE_MAX = 5000;
export let fontGeneration = 0;
const fontListeners = new Set<() => void>();
/** Register a callback for when installed fonts finish loading (layout caches depend on text metrics). */
export function onFontsChanged(fn: () => void): void {
  fontListeners.add(fn);
}
if (typeof document !== "undefined" && "fonts" in document) {
  document.fonts.addEventListener("loadingdone", () => {
    measureCache.clear();
    fontGeneration++;
    fontListeners.forEach((fn) => fn());
  });
}

/** Width of a plain string in mm for the given style. */
export function measureTextMm(text: string, style: TextStyle): number {
  const c = measureCtx();
  if (!c) return text.length * ptToMm(style.sizePt) * 0.55;
  const font = fontCss(style, 10); // measure at 10 px/mm for precision
  const key = font + "\0" + text;
  const hit = measureCache.get(key);
  if (hit !== undefined) return hit;
  c.font = font;
  const w = c.measureText(text).width / 10;
  if (measureCache.size >= MEASURE_CACHE_MAX) measureCache.clear();
  measureCache.set(key, w);
  return w;
}

/** Approximate line height (ascent+descent) in mm. */
export function lineHeightMm(style: TextStyle): number {
  return ptToMm(style.sizePt) * 1.15;
}

export function fmtMm(v: number): string {
  return Number(v.toFixed(4)).toString();
}
