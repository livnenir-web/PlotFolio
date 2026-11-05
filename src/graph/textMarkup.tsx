// Lightweight LaTeX-like markup for axis titles, legends and text labels.
// Supported: \alpha … \omega (Greek, capitalised for upper case), \times \pm \mp \degree \deg \cdot \infty \leq \geq \neq \approx \angstrom \micro \sum \Delta,
// ^{…} and _{…} (or ^x / _x for a single character), \it{…}, \bf{…}, \rm{…}, \\ for a backslash, and \n for a line break.

import type { TextStyle } from "../model/types";
import { measureTextMm, ptToMm, quoteFont } from "./units";

export interface Segment {
  text: string;
  level: number; // 0 normal, +1 superscript, -1 subscript (nested adds)
  italic: boolean;
  bold: boolean;
  underline?: boolean;
}

const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ϵ", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ",
  phi: "φ", varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", pm: "±", mp: "∓", cdot: "·", degree: "°", deg: "°", infty: "∞", leq: "≤", geq: "≥", neq: "≠", approx: "≈",
  propto: "∝", rightarrow: "→", leftarrow: "←", angstrom: "Å", micro: "µ", sum: "∑", int: "∫", partial: "∂", nabla: "∇",
  prime: "′", bullet: "•", dagger: "†", percent: "%", ohm: "Ω", hbar: "ℏ", ell: "ℓ", sqrt: "√", ldots: "…", minus: "−",
};

export const SYMBOL_LIST = Object.entries(SYMBOLS).map(([k, v]) => ({ code: `\\${k}`, char: v }));

interface State {
  s: string;
  i: number;
}

function readGroup(st: State): string {
  // assumes st.s[st.i] === '{'
  let depth = 0;
  const start = st.i + 1;
  for (; st.i < st.s.length; st.i++) {
    const ch = st.s[st.i];
    if (ch === "\\") {
      st.i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const g = st.s.slice(start, st.i);
        st.i++;
        return g;
      }
    }
  }
  const g = st.s.slice(start);
  st.i = st.s.length;
  return g;
}

function parseInto(s: string, out: Segment[], level: number, italic: boolean, bold: boolean, underline = false) {
  const st: State = { s, i: 0 };
  let buf = "";
  const flush = () => {
    if (buf) out.push({ text: buf, level, italic, bold, underline });
    buf = "";
  };
  while (st.i < s.length) {
    const ch = s[st.i];
    if (ch === "\\") {
      const m = /^\\([A-Za-z]+)/.exec(s.slice(st.i));
      if (m) {
        const name = m[1];
        st.i += m[0].length;
        if (name === "it" || name === "bf" || name === "rm" || name === "ul") {
          if (s[st.i] === "{") {
            const g = readGroup(st);
            flush();
            parseInto(g, out, level, name === "it" ? true : name === "rm" ? false : italic, name === "bf" ? true : name === "rm" ? false : bold, name === "ul" ? true : name === "rm" ? false : underline);
          }
          continue;
        }
        if (name === "n") {
          flush();
          out.push({ text: "\n", level, italic, bold, underline });
          continue;
        }
        const sym = SYMBOLS[name];
        if (sym !== undefined) {
          buf += sym;
          continue;
        }
        buf += "\\" + name;
        continue;
      }
      // escaped char
      if (st.i + 1 < s.length) {
        buf += s[st.i + 1];
        st.i += 2;
      } else st.i++;
      continue;
    }
    if (ch === "^" || ch === "_") {
      const delta = ch === "^" ? 1 : -1;
      st.i++;
      let g: string;
      if (s[st.i] === "{") g = readGroup(st);
      else if (st.i < s.length) {
        if (s[st.i] === "\\") {
          const m = /^\\[A-Za-z]+/.exec(s.slice(st.i));
          g = m ? m[0] : s[st.i];
          st.i += g.length;
        } else {
          g = s[st.i];
          st.i++;
        }
      } else g = "";
      flush();
      parseInto(g, out, level + delta, italic, bold, underline);
      continue;
    }
    if (ch === "{" ) {
      const g = readGroup(st);
      flush();
      parseInto(g, out, level, italic, bold, underline);
      continue;
    }
    if (ch === "}") {
      st.i++;
      continue;
    }
    if (ch === "\n") {
      // a real line break behaves like \n markup
      flush();
      out.push({ text: "\n", level, italic, bold, underline });
      st.i++;
      continue;
    }
    buf += ch;
    st.i++;
  }
  flush();
}

const parseCache = new Map<string, Segment[]>();
const PARSE_CACHE_MAX = 5000;

/** Parse markup into segments. Cached by text; the returned array is shared, never mutate it. */
export function parseMarkup(text: string): Segment[] {
  const key = text ?? "";
  const hit = parseCache.get(key);
  if (hit) return hit;
  const out: Segment[] = [];
  parseInto(key, out, 0, false, false);
  if (parseCache.size >= PARSE_CACHE_MAX) parseCache.clear();
  parseCache.set(key, out);
  return out;
}

/** Plain text with symbols substituted and scripts flattened (for measuring and tooltips). */
export function markupToPlain(text: string): string {
  return parseMarkup(text).map((s) => s.text).join("");
}

export function splitLines(segs: Segment[]): Segment[][] {
  const lines: Segment[][] = [[]];
  for (const s of segs) {
    if (s.text === "\n") lines.push([]);
    else lines[lines.length - 1].push(s);
  }
  return lines;
}

export const SCRIPT_SCALE = 0.7;
const SUP_SHIFT = 0.4; // fraction of the parent font size
const SUB_SHIFT = -0.2;

/** Approximate width in mm of a markup line. */
export function measureMarkupMm(text: string, style: TextStyle): { width: number; lines: number } {
  const lines = splitLines(parseMarkup(text));
  let max = 0;
  for (const line of lines) {
    let w = 0;
    for (const s of line) {
      const scale = Math.pow(SCRIPT_SCALE, Math.abs(s.level));
      w += measureTextMm(s.text, { ...style, sizePt: style.sizePt * scale, italic: s.italic || style.italic, bold: s.bold || style.bold });
    }
    max = Math.max(max, w);
  }
  return { width: max, lines: lines.length };
}

export interface MarkupTextProps {
  text: string;
  x: number;
  y: number;
  style: TextStyle;
  anchor?: "start" | "middle" | "end";
  /** vertical anchor of the first line: baseline (default), middle, hanging */
  vAnchor?: "baseline" | "middle" | "hanging";
  rotate?: number;
  className?: string;
  lineSpacing?: number;
  extra?: React.SVGProps<SVGTextElement>;
}

/**
 * Render markup text as an SVG <text> with <tspan>s. Coordinates are in mm (the SVG user unit).
 */
export function MarkupText({ text, x, y, style, anchor = "start", vAnchor = "baseline", rotate, className, lineSpacing = 1.2, extra }: MarkupTextProps) {
  const sizeMm = ptToMm(style.sizePt);
  const lines = splitLines(parseMarkup(text));
  const lineH = sizeMm * lineSpacing;
  let y0 = y;
  if (vAnchor === "middle") y0 = y + sizeMm * 0.35 - ((lines.length - 1) * lineH) / 2;
  else if (vAnchor === "hanging") y0 = y + sizeMm * 0.85;
  return (
    <text
      x={x}
      y={y0}
      fontFamily={quoteFont(style.font)}
      fontSize={sizeMm}
      fontWeight={style.bold ? "bold" : undefined}
      fontStyle={style.italic ? "italic" : undefined}
      fill={style.color}
      textAnchor={anchor}
      transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}
      className={className}
      {...extra}
    >
      {lines.map((line, li) => {
        let shiftAcc = 0; // current vertical shift relative to baseline, in mm
        const parts: React.ReactNode[] = [];
        line.forEach((s, si) => {
          const scale = Math.pow(SCRIPT_SCALE, Math.abs(s.level));
          const target = s.level > 0 ? -SUP_SHIFT * sizeMm * (1 + (s.level - 1) * 0.5) : s.level < 0 ? -SUB_SHIFT * sizeMm * (1 + (-s.level - 1) * 0.5) : 0;
          const dy = target - shiftAcc;
          shiftAcc = target;
          parts.push(
            <tspan
              key={si}
              dy={dy !== 0 ? dy : undefined}
              fontSize={s.level !== 0 ? sizeMm * scale : undefined}
              fontStyle={s.italic ? "italic" : undefined}
              fontWeight={s.bold ? "bold" : undefined}
              textDecoration={s.underline ? "underline" : undefined}
            >
              {s.text}
            </tspan>,
          );
        });
        if (shiftAcc !== 0 && lines.length > 1) parts.push(<tspan key="reset" dy={-shiftAcc} fontSize={0.01}>{"​"}</tspan>);
        if (li === 0) return parts;
        return (
          <tspan key={li} x={x} dy={lineH}>
            {parts}
          </tspan>
        );
      })}
    </text>
  );
}
