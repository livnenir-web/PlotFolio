// Animation frames. A frame is derived from the full (cached) layout of a figure and a time t in 0…1:
// nothing is laid out again, layers that the animation does not touch keep their identity (so their memoized
// SVG is reused), and the document is never written. The same function feeds the on-screen preview and the
// video export, so both show exactly the same frames.
import type { Animation, BuildUpEffect, Easing, Graph, Layer, Plot, RevealEffect } from "../model/types";
import { shownLayers } from "../model/figure";
import type { XYData } from "./data";
import { legendGeom, xAxisOver, type AnimMarker, type AxisGeom, type GraphLayout, type LayerAnim, type LayerLayout } from "./layout";
import { makeProjector } from "./projection3d";
import type { AxisScale } from "./scales";

type XYZ = XYData & { z?: number[] };

export function ease(kind: Easing, t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return kind === "inOut" ? (c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2) : c;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/** Frames of an animation: the moving part (t from 0 to 1) followed by the hold on the last frame. */
export function frameSchedule(anim: Pick<Animation, "durationS" | "fps" | "holdEndS">): { count: number; moving: number; tAt: (i: number) => number } {
  const fps = Math.max(1, anim.fps);
  const moving = Math.max(1, Math.round(Math.max(0.05, anim.durationS) * fps));
  const hold = Math.max(0, Math.round(Math.max(0, anim.holdEndS) * fps));
  return { count: moving + 1 + hold, moving, tAt: (i) => Math.min(1, Math.max(0, i) / moving) };
}

/** Frame shown after `elapsedS` seconds of playback; `done` when a non-looping animation reached its end. */
export function playbackFrame(elapsedS: number, anim: Pick<Animation, "durationS" | "fps" | "holdEndS" | "loop">): { index: number; done: boolean } {
  const { count } = frameSchedule(anim);
  const i = Math.max(0, Math.floor(elapsedS * Math.max(1, anim.fps) + 1e-6));
  if (anim.loop) return { index: i % count, done: false };
  return i >= count - 1 ? { index: count - 1, done: true } : { index: i, done: false };
}

/** Plot types that can be revealed point by point. */
const REVEALABLE = new Set<Plot["type"]>(["scatter", "line", "lineScatter", "fitCurve", "function", "scatter3d"]);

export function isRevealable(p: Plot): boolean {
  return REVEALABLE.has(p.type);
}

const monotonic = new WeakMap<object, boolean>();
function nonDecreasing(x: number[]): boolean {
  let m = monotonic.get(x);
  if (m === undefined) {
    m = true;
    for (let i = 1; i < x.length; i++)
      if (x[i] < x[i - 1]) {
        m = false;
        break;
      }
    monotonic.set(x, m);
  }
  return m;
}

/** Number of leading values ≤ c in a non-decreasing array. */
function countLE(x: number[], c: number): number {
  let lo = 0;
  let hi = x.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= c) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/** Number of leading values < c in a non-decreasing array. */
function countLT(x: number[], c: number): number {
  let lo = 0;
  let hi = x.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x[mid] < c) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Every per-point array of a data set cut to [a, b). */
function sliceData(d: XYZ, a: number, b: number): XYZ {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) out[k] = Array.isArray(v) ? v.slice(a, b) : v;
  return out as unknown as XYZ;
}

interface Scales {
  x: AxisScale;
  y: AxisScale;
  z?: AxisScale;
}

/** Interpolate in axis space (so the point lies on the drawn segment on log axes too), falling back to data space. */
function between(scale: AxisScale | undefined, a: number, b: number, f: number): number {
  if (scale) {
    const ma = scale.map(a);
    const mb = scale.map(b);
    if (ma !== null && mb !== null) {
      const v = scale.invert(lerp(ma, mb, f));
      if (Number.isFinite(v)) return v;
    }
  }
  return lerp(a, b, f);
}

/** The point a fraction f of the way from sample i to i + 1 of d, for every per-point array. */
function pointBetween(d: XYZ, i: number, f: number, sc: Scales, connect: string, xExact?: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (!Array.isArray(v)) continue;
    const a = v[i];
    const b = v[i + 1];
    if (typeof a !== "number" || typeof b !== "number") out[k] = null;
    else if (k === "x") out[k] = xExact ?? between(sc.x, a, b, f);
    else if (k === "y") out[k] = connect === "stepH" ? a : connect === "stepV" ? b : between(sc.y, a, b, f);
    else if (k === "z") out[k] = between(sc.z, a, b, f);
    else out[k] = lerp(a, b, f);
  }
  return out;
}

function withPoint(d: XYZ, p: Record<string, unknown>, where: "head" | "tail"): XYZ {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) out[k] = Array.isArray(v) ? (where === "tail" ? [...v, p[k]] : [p[k], ...v]) : v;
  return out as unknown as XYZ;
}

interface Revealed {
  data: XYZ;
  head: boolean;
  tail: boolean;
  /** current point in data units, or null before the first point */
  at: { x: number; y: number; z?: number } | null;
}

/**
 * The part of a data set drawn at local time t.
 * Along x: everything up to the cutoff `c`. Along the point order: the first t·(n − 1) + 1 points.
 * With `interp`, the line ends exactly at the cutoff on an interpolated point (flagged `tail`).
 */
function revealData(d: XYZ, t: number, opts: { c: number | null; window: number | null; trimBelow: number | null; interp: boolean; connect: string }, sc: Scales): Revealed {
  const n = d.x.length;
  if (n === 0) return { data: d, head: false, tail: false, at: null };
  const pick = (i: number) => ({ x: d.x[i], y: d.y[i], z: d.z?.[i] });
  let a = 0; // first kept sample
  let k: number; // one past the last kept sample
  let tailPt: Record<string, unknown> | null = null;
  let headPt: Record<string, unknown> | null = null;
  let at: Revealed["at"];
  if (opts.c !== null) {
    const c = opts.c;
    k = countLE(d.x, c);
    if (k === 0) return { data: sliceData(d, 0, 0), head: false, tail: false, at: null };
    at = pick(k - 1);
    if (opts.interp && k < n && c > d.x[k - 1] && d.x[k] > d.x[k - 1]) {
      const mx0 = sc.x.map(d.x[k - 1]);
      const mx1 = sc.x.map(d.x[k]);
      const mc = sc.x.map(c);
      const f = mx0 !== null && mx1 !== null && mc !== null && mx1 !== mx0 ? (mc - mx0) / (mx1 - mx0) : (c - d.x[k - 1]) / (d.x[k] - d.x[k - 1]);
      tailPt = pointBetween(d, k - 1, Math.min(1, Math.max(0, f)), sc, opts.connect, c);
      at = { x: c, y: tailPt.y as number, z: tailPt.z as number | undefined };
    }
    if (opts.window !== null) {
      const s = c - opts.window;
      a = Math.min(countLT(d.x, s), k);
      if (opts.interp && a > 0 && a < n && d.x[a] > s && d.x[a] > d.x[a - 1]) {
        const f = (s - d.x[a - 1]) / (d.x[a] - d.x[a - 1]);
        headPt = pointBetween(d, a - 1, Math.min(1, Math.max(0, f)), sc, opts.connect, s);
      }
    }
    // "follow" axes: points left of the visible window are not drawn (one is kept so the line enters from the edge)
    if (opts.trimBelow !== null && !headPt) a = Math.max(a, Math.min(k - 1, countLT(d.x, opts.trimBelow) - 1));
  } else {
    const pos = Math.min(1, Math.max(0, t)) * (n - 1);
    const i0 = Math.min(n - 1, Math.floor(pos + 1e-9));
    const f = pos - i0;
    k = i0 + 1;
    at = pick(i0);
    if (f > 1e-9 && k < n) {
      if (opts.interp) {
        tailPt = pointBetween(d, i0, f, sc, opts.connect);
        at = { x: tailPt.x as number, y: tailPt.y as number, z: tailPt.z as number | undefined };
      }
    }
    if (opts.window !== null) {
      const sp = pos - opts.window;
      if (sp > 0) {
        const j = Math.floor(sp);
        a = Math.min(k, j + 1);
        if (opts.interp && sp - j > 1e-9 && j + 1 < n) headPt = pointBetween(d, j, sp - j, sc, opts.connect);
      }
    }
  }
  let data = a === 0 && k === n ? d : sliceData(d, a, k);
  if (tailPt) data = withPoint(data, tailPt, "tail");
  if (headPt) data = withPoint(data, headPt, "head");
  return { data, head: !!headPt, tail: !!tailPt, at };
}

/** Build-up state of one plot at time t. */
interface Appearance {
  shown: boolean;
  opacity: number;
  /** time within the plot's own step, 0…1 (1 once the step is over) */
  local: number;
}

/** What appears in one step of the build-up: a plot, a curve group or a layer, with the plots it brings. */
export interface BuildUnit {
  key: string;
  label: string;
  plotIds: string[];
}

/**
 * The steps of the build-up in the order they appear: every shown plot on its own, or — by `buildUp.unit` — the
 * curves of a group together (in all layers; plots outside a group stay single steps), or one layer after another.
 * Keys listed in `buildUp.order` come first, the rest follows in the order of the figure.
 */
export function buildUpUnits(graph: Graph, buildUp: BuildUpEffect): BuildUnit[] {
  const unit = buildUp.unit ?? "plot";
  const groups = new Map((graph.plotGroups ?? []).map((g) => [g.id, g]));
  const units = new Map<string, BuildUnit>();
  for (const l of shownLayers(graph)) {
    for (const p of l.plots) {
      if (!p.visible) continue;
      const g = unit === "group" && p.groupId ? groups.get(p.groupId) : undefined;
      const key = unit === "layer" ? `l:${l.id}` : g ? `g:${g.id}` : p.id;
      const u = units.get(key);
      if (u) u.plotIds.push(p.id);
      else units.set(key, { key, label: unit === "layer" ? l.name : g ? g.name : p.name, plotIds: [p.id] });
    }
  }
  const listed = (buildUp.order ?? []).filter((k, i, a) => units.has(k) && a.indexOf(k) === i);
  return [...listed.map((k) => units.get(k)!), ...[...units.values()].filter((u) => !listed.includes(u.key))];
}

function buildUpState(layout: GraphLayout, anim: Animation, t: number): { of: (plotId: string) => Appearance | null; current: number; isCurrent: (plotId: string) => boolean } {
  const order = buildUpUnits(layout.graph, anim.buildUp);
  const n = order.length;
  if (!n) return { of: () => null, current: 1, isCurrent: () => false };
  const pos = Math.min(1, Math.max(0, t)) * n;
  const step = Math.min(n - 1, Math.floor(pos + 1e-9));
  const index = new Map<string, number>();
  order.forEach((u, i) => u.plotIds.forEach((id) => index.set(id, i)));
  const fade = anim.buildUp.transition === "fade" ? Math.min(1, Math.max(0.01, anim.buildUp.fadeFraction)) : 0;
  return {
    current: t >= 1 ? 1 : pos - step,
    isCurrent: (id) => index.get(id) === step,
    of: (id) => {
      const i = index.get(id);
      if (i === undefined) return null;
      if (t >= 1 || i < step) return { shown: true, opacity: 1, local: 1 };
      if (i > step) return { shown: false, opacity: 0, local: 0 };
      const local = pos - step;
      return { shown: true, opacity: fade ? Math.min(1, local / fade) : 1, local };
    },
  };
}

/** Plots of a layer that the reveal effect animates. */
export function revealedPlots(ll: LayerLayout, reveal: RevealEffect): Plot[] {
  if (!reveal.enabled) return [];
  return ll.layer.plots.filter((p) => p.visible && isRevealable(p) && ll.data.has(p.id) && (reveal.plotIds === null || reveal.plotIds.includes(p.id)));
}

/** Along x unless the data goes back and forth (a trajectory), which can only be revealed in point order. */
function alongX(ll: LayerLayout, p: Plot, reveal: RevealEffect): boolean {
  if (reveal.mode !== "x" || ll.is3d) return false;
  const d = ll.data.get(p.id);
  return !!d && nonDecreasing(d.x);
}

/**
 * x range a layer's reveal sweeps: the typed range, else the extent of its plots that reveal along x. With fixed
 * axes only the part of the data inside the x axis counts, so no time is spent on what the figure does not show.
 * `typed: false` ignores the typed range (see `typedRangeApplies`).
 */
export function revealRange(ll: LayerLayout, reveal: RevealEffect, typed = true): { from: number; to: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of revealedPlots(ll, reveal)) {
    if (!alongX(ll, p, reveal)) continue;
    const x = ll.data.get(p.id)!.x;
    if (!x.length) continue;
    lo = Math.min(lo, x[0]);
    hi = Math.max(hi, x[x.length - 1]);
  }
  if (!(hi >= lo)) return null;
  if (reveal.axes === "fixed") {
    const a = Math.min(ll.x.scale.from, ll.x.scale.to);
    const b = Math.max(ll.x.scale.from, ll.x.scale.to);
    if (Math.max(lo, a) < Math.min(hi, b)) {
      lo = Math.max(lo, a);
      hi = Math.min(hi, b);
    }
  }
  const from = (typed ? reveal.from : null) ?? lo;
  const to = (typed ? reveal.to : null) ?? hi;
  return to > from ? { from, to } : { from: Math.min(from, to), to: Math.max(from, to) };
}

/** The layer a typed range is given for: the first one with plots that reveal along x (where "Pick" drags). */
export function rangeLayerOf(layout: GraphLayout, reveal: RevealEffect): LayerLayout | null {
  return layout.layers.find((ll) => revealRange(ll, { ...reveal, enabled: true }, false) !== null) ?? null;
}

/**
 * A typed range is in the units of one x axis. It applies to the layer it was given for and to layers whose x axis
 * has the same title (panels over the same time axis); a panel over another quantity runs through its own range.
 */
function typedRangeApplies(layout: GraphLayout, reveal: RevealEffect, ll: LayerLayout): boolean {
  if (reveal.from === null && reveal.to === null) return false;
  const base = rangeLayerOf(layout, reveal);
  return !!base && (base.layer.id === ll.layer.id || base.layer.axes.x.title === ll.layer.axes.x.title);
}

const fmtValue = (v: number, decimals: number) => (Number.isFinite(v) ? v.toFixed(Math.max(0, Math.min(10, Math.round(decimals)))) : "");

function frameLayer(ll: LayerLayout, anim: Animation, t: number, build: ReturnType<typeof buildUpState> | null, typed: boolean): LayerLayout {
  let layer: Layer = ll.layer;
  let out: LayerLayout | null = null;
  const edit = () => (out ??= { ...ll });
  const plotOpacity = new Map<string, number>();
  let projector = ll.projector;

  // ---- build-up: later plots are hidden, the entering one may fade in
  if (build) {
    let changed = false;
    const plots = layer.plots.map((p) => {
      const a = build.of(p.id);
      if (!a) return p;
      if (a.opacity < 1 && a.shown) plotOpacity.set(p.id, a.opacity);
      if (a.shown) return p;
      changed = true;
      return { ...p, visible: false };
    });
    if (changed) {
      layer = { ...layer, plots };
      edit().legend = legendGeom(layer, layer.legend, layer.legend.style);
    }
  }

  // ---- rotate the 3D view
  if (anim.rotate.enabled && ll.is3d && layer.view3d) {
    const r = anim.rotate;
    const f = ease(r.easing, t);
    const view = { ...layer.view3d, azimuth: lerp(r.azimuthFrom, r.azimuthTo, f), elevation: Math.max(-89, Math.min(89, lerp(r.elevationFrom, r.elevationTo, f))) };
    layer = { ...layer, view3d: view };
    projector = makeProjector(view, layer.frame);
    edit().projector = projector;
  }

  // ---- reveal the data
  const reveal = anim.reveal;
  const animated = revealedPlots(ll, reveal).filter((p) => !build || build.of(p.id)?.shown !== false);
  let la: LayerAnim | null = null;
  if (animated.length) {
    const range = revealRange(ll, reveal, typed);
    // with build-up, each plot is drawn during its own step; the cursor and a following axis track the entering plot
    const tOf = (p: Plot) => (build ? (build.of(p.id)?.local ?? 1) : t);
    const tCur = build ? build.current : t;
    const cCur = range ? lerp(range.from, range.to, tCur) : null;
    const follow = reveal.axes === "follow" && !ll.is3d && range !== null && reveal.followWindow > 0;
    let xGeom: AxisGeom = ll.x;
    let winLo: number | null = null;
    if (follow && cCur !== null) {
      const w = Math.min(reveal.followWindow, range!.to - range!.from) || reveal.followWindow;
      winLo = Math.max(range!.from, cCur - w);
      xGeom = xAxisOver(ll, winLo, winLo + w);
    }
    const data = new Map(ll.data);
    const partial = new Map<string, { head: boolean; tail: boolean }>();
    const tailMask = new Map<string, { x0Mm: number; x1Mm: number }>();
    const fadeByOrder = new Set<string>();
    const markers: AnimMarker[] = [];
    const f = layer.frame;
    const proj = projector;
    for (const p of animated) {
      const d = ll.data.get(p.id) as XYZ;
      const byX = alongX(ll, p, reveal) && range !== null;
      const tp = tOf(p);
      const yGeom = p.yAxis === "y2" && ll.y2 ? ll.y2 : ll.y;
      const sc: Scales = { x: xGeom.scale, y: yGeom.scale, z: ll.zScale };
      const joined = p.type === "scatter3d" ? !!p.joinPoints : p.showLine;
      const window = reveal.tail.mode !== "none" && reveal.tail.window > 0 ? reveal.tail.window : null;
      const r = revealData(d, tp, { c: byX ? lerp(range!.from, range!.to, tp) : null, window, trimBelow: byX ? winLo : null, interp: joined, connect: p.line.connect ?? "straight" }, sc);
      if (r.data !== d) data.set(p.id, r.data);
      if (r.head || r.tail) partial.set(p.id, { head: r.head, tail: r.tail });
      if (window !== null && reveal.tail.mode === "fade" && r.at) {
        if (byX) {
          const x1 = sc.x.map(r.at.x);
          const x0 = sc.x.map(r.at.x - window);
          if (x0 !== null && x1 !== null && x0 !== x1) tailMask.set(p.id, { x0Mm: x0, x1Mm: x1 });
        } else fadeByOrder.add(p.id);
      }
      // with build-up only the plot being drawn carries the symbol
      if (!r.at || !reveal.marker.show || (build && !build.isCurrent(p.id))) continue;
      // the current point, on the frame (3D: projected). A point outside the data area gets no symbol.
      const mx = sc.x.map(r.at.x);
      const my = sc.y.map(r.at.y);
      if (mx === null || my === null) continue;
      if (ll.is3d) {
        const mz = r.at.z !== undefined && sc.z ? sc.z.map(r.at.z) : null;
        if (mz === null || !proj) continue;
        const [px, py, depth] = proj.project((mx - f.xMm) / f.wMm, (f.yMm + f.hMm - my) / f.hMm, mz);
        markers.push({ plotId: p.id, ...r.at, xMm: px, yMm: py, depth });
      } else {
        const eps = 0.05;
        if (mx < f.xMm - eps || mx > f.xMm + f.wMm + eps || my < f.yMm - eps || my > f.yMm + f.hMm + eps) continue;
        markers.push({ plotId: p.id, ...r.at, xMm: mx, yMm: my });
      }
    }
    // cursor line and values
    let cursorXMm: number | null = null;
    if (reveal.cursor.show && cCur !== null && !ll.is3d) {
      const cx = xGeom.scale.map(cCur);
      if (cx !== null && cx >= f.xMm - 0.05 && cx <= f.xMm + f.wMm + 0.05) cursorXMm = cx;
    }
    const readout: LayerAnim["readout"] = [];
    if (reveal.readout.show) {
      const dec = reveal.readout.decimals;
      const text = (m: AnimMarker) => [m.x, m.y, ...(m.z !== undefined ? [m.z] : [])].map((v) => fmtValue(v, dec)).join(", ");
      if (reveal.readout.position === "corner" || ll.is3d) {
        const name = (m: AnimMarker) => (markers.length > 1 ? `${layer.plots.find((p) => p.id === m.plotId)?.name ?? ""}: ` : "");
        markers.forEach((m, i) => readout.push({ text: name(m) + text(m), xMm: f.xMm + 1.2, yMm: f.yMm + 1.2 + i * 3.4, anchor: "start" }));
      } else {
        for (const m of markers) {
          const right = m.xMm > f.xMm + f.wMm * 0.68;
          readout.push({ text: text(m), xMm: m.xMm + (right ? -1.4 : 1.4), yMm: m.yMm - 1.4, anchor: right ? "end" : "start" });
        }
      }
    }
    la = { plotOpacity, partial, tailMask, fadeByOrder, markers, cursorXMm, readout, style: { marker: reveal.marker, cursor: reveal.cursor, readout: reveal.readout } };
    const o = edit();
    o.data = data;
    if (xGeom !== ll.x) {
      o.x = xGeom;
      reanchor(o, ll, xGeom);
    }
  } else if (plotOpacity.size) {
    la = { plotOpacity, partial: new Map(), tailMask: new Map(), fadeByOrder: new Set(), markers: [], cursorXMm: null, readout: [], style: { marker: reveal.marker, cursor: reveal.cursor, readout: reveal.readout } };
  }

  if (!out && !la) return ll;
  const o = edit();
  o.layer = layer;
  if (la) o.anim = la;
  return o;
}

/** Positions that are anchored in axis units follow the moved x axis. */
function reanchor(o: LayerLayout, ll: LayerLayout, x: AxisGeom) {
  const f = ll.layer.frame;
  const toMm = (vx: number, vy: number) => ({ x: x.scale.map(vx) ?? f.xMm, y: ll.toMm(vx, vy).y });
  o.toMm = toMm;
  o.toData = (mx, my) => ({ x: x.scale.invert(mx), y: ll.toData(mx, my).y });
  const shapes = (ll.layer.shapes ?? []).filter((s) => s.coord === "data");
  if (shapes.length) {
    const shapeMm = new Map(ll.shapeMm);
    const shapePointsMm = new Map(ll.shapePointsMm);
    for (const sh of shapes) {
      if (sh.points) {
        const pts = sh.points.map((p) => toMm(p.x, p.y));
        shapePointsMm.set(sh.id, pts);
        shapeMm.set(sh.id, { x1: Math.min(...pts.map((p) => p.x)), y1: Math.min(...pts.map((p) => p.y)), x2: Math.max(...pts.map((p) => p.x)), y2: Math.max(...pts.map((p) => p.y)) });
      } else {
        const a = toMm(sh.x1, sh.y1);
        const b = toMm(sh.x2, sh.y2);
        shapeMm.set(sh.id, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    }
    o.shapeMm = shapeMm;
    o.shapePointsMm = shapePointsMm;
  }
  const texts = ll.layer.texts.filter((tx) => tx.coord === "data");
  if (texts.length) {
    const textMm = new Map(ll.textMm);
    for (const tx of texts) textMm.set(tx.id, toMm(tx.xMm, tx.yMm));
    o.textMm = textMm;
  }
}

/** True when the animation changes what is drawn. */
export function isAnimated(anim: Animation | undefined): anim is Animation {
  return !!anim && anim.enabled && (anim.reveal.enabled || anim.rotate.enabled || anim.buildUp.enabled);
}

/**
 * The layout of one animation frame at time t (0…1). Returns `layout` itself when there is nothing to animate;
 * otherwise a copy in which only the layers the animation touches are new objects.
 */
export function animationFrame(layout: GraphLayout, anim: Animation | undefined, t: number): GraphLayout {
  if (!isAnimated(anim)) return layout;
  const tt = Math.min(1, Math.max(0, t));
  const build = anim.buildUp.enabled ? buildUpState(layout, anim, tt) : null;
  let changed = false;
  const layers = layout.layers.map((ll) => {
    const fl = frameLayer(ll, anim, tt, build, typedRangeApplies(layout, anim.reveal, ll));
    if (fl !== ll) changed = true;
    return fl;
  });
  return changed ? { ...layout, layers } : layout;
}
