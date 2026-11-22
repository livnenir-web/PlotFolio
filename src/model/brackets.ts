// Significance brackets that belong to two box-type plots (Shape.between). Such a bracket follows its plots: it is
// drawn above where they stand now (so hiding or reordering other groups does not leave it over the wrong ones) and
// is left out while either of them is hidden.
import type { Graph, Layer, Plot, Shape } from "./types";

/** The plots that make the categories of a box-type layer, in the order of the category axis. */
function shownBoxes(layer: Layer): Plot[] {
  return layer.plots.filter((p) => p.visible && p.type === "box");
}

/** Categories run along y when the groups lie on their side (as layout.ts decides it). */
function categoriesAlongY(layer: Layer): boolean {
  const bar = layer.plots.find((p) => p.visible && p.type === "bar");
  return !!(bar?.bar?.horizontal ?? shownBoxes(layer)[0]?.bar?.horizontal);
}

const isAxisBracket = (sh: Shape): boolean => sh.kind === "bracket" && sh.coord === "data" && !sh.points;
const isLinked = (sh: Shape): sh is Shape & { between: [string, string] } => isAxisBracket(sh) && !!sh.between;

/**
 * The layer as it is drawn: linked brackets moved to where their two plots stand now, and left out while either
 * plot is hidden. Each end keeps its small offset from the middle of its group. Returns the layer itself when
 * nothing differs (the usual case), so caches keyed by the layer keep working.
 */
export function placeBrackets(layer: Layer): Layer {
  if (!layer.shapes?.some(isLinked)) return layer;
  const boxes = shownBoxes(layer);
  const alongY = categoriesAlongY(layer);
  let changed = false;
  const shapes: Shape[] = [];
  for (const sh of layer.shapes) {
    if (!isLinked(sh)) {
      shapes.push(sh);
      continue;
    }
    const ia = boxes.findIndex((p) => p.id === sh.between[0]);
    const ib = boxes.findIndex((p) => p.id === sh.between[1]);
    if (ia < 0 || ib < 0) {
      changed = true;
      continue;
    }
    const [c1, c2] = alongY ? [sh.y1, sh.y2] : [sh.x1, sh.x2];
    // when the two groups have swapped sides, the offsets swap sign too, so the ends still point inward
    const flip = Math.sign(ib - ia) !== Math.sign(c2 - c1) && c1 !== c2 ? -1 : 1;
    const n1 = ia + 1 + flip * (c1 - Math.round(c1));
    const n2 = ib + 1 + flip * (c2 - Math.round(c2));
    if (Math.abs(n1 - c1) < 1e-9 && Math.abs(n2 - c2) < 1e-9) shapes.push(sh);
    else {
      changed = true;
      shapes.push(alongY ? { ...sh, y1: n1, y2: n2 } : { ...sh, x1: n1, x2: n2 });
    }
  }
  return changed ? { ...layer, shapes } : layer;
}

/** The two groups a bracket joins, as places on the category axis (0-based, low to high); null when it is not shown. */
export function bracketSpan(layer: Layer, sh: Shape): { lo: number; hi: number } | null {
  if (!isAxisBracket(sh)) return null;
  let a: number;
  let b: number;
  if (sh.between) {
    const boxes = shownBoxes(layer);
    a = boxes.findIndex((p) => p.id === sh.between![0]);
    b = boxes.findIndex((p) => p.id === sh.between![1]);
    if (a < 0 || b < 0) return null;
  } else {
    const [c1, c2] = categoriesAlongY(layer) ? [sh.y1, sh.y2] : [sh.x1, sh.x2];
    a = Math.round(c1) - 1;
    b = Math.round(c2) - 1;
  }
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

/**
 * Brackets made before brackets knew their plots: give each the two groups it stands over now. Run when a project
 * is opened; brackets that already have their plots, or that do not stand over two groups, are left alone.
 */
export function linkBrackets(layer: Layer): void {
  if (!layer.shapes?.some((sh) => isAxisBracket(sh) && !sh.between)) return;
  const boxes = shownBoxes(layer);
  const alongY = categoriesAlongY(layer);
  for (const sh of layer.shapes) {
    if (!isAxisBracket(sh) || sh.between) continue;
    const [c1, c2] = alongY ? [sh.y1, sh.y2] : [sh.x1, sh.x2];
    const a = boxes[Math.round(c1) - 1];
    const b = boxes[Math.round(c2) - 1];
    if (a && b && a !== b) sh.between = [a.id, b.id];
  }
}

/** Remove the brackets of plots that are no longer in their layer (a deleted group takes its brackets along). */
export function dropOrphanBrackets(graph: Graph): void {
  for (const l of graph.layers) {
    if (!l.shapes?.some(isLinked)) continue;
    const ids = new Set(l.plots.map((p) => p.id));
    if (l.shapes.every((sh) => !isLinked(sh) || (ids.has(sh.between[0]) && ids.has(sh.between[1])))) continue;
    l.shapes = l.shapes.filter((sh) => !isLinked(sh) || (ids.has(sh.between[0]) && ids.has(sh.between[1])));
  }
}
