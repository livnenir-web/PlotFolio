// Drag a row of a list to another place in it. Rows of one list carry `data-reorder="<scope>"` (and their id in
// `data-reorder-id`); `startReorder` goes in the row's onPointerDown. Pointer events, not HTML drag and drop: the
// Mac app's web view keeps those for files dropped on the window.
import type { PointerEvent as RPointerEvent } from "react";

export interface ReorderOptions {
  /** rows with this `data-reorder` value form the list */
  scope: string;
  /** `data-reorder-id` of the row being dragged */
  id: string;
  /** rows side by side instead of one under the other */
  horizontal?: boolean;
  /** Called at release when the row lands elsewhere: its index before, and its index in the list after the move. */
  onMove: (from: number, to: number) => void;
}

/** Controls inside a row that keep their own mouse behavior. */
const CONTROLS = "input, button, select, textarea, a, [contenteditable], [data-no-reorder]";
const THRESHOLD_PX = 4;
const EDGE_PX = 28;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** Where a pointer at `pos` would insert among rows with these start/end edges: 0 … n. */
export function insertionIndex(edges: { start: number; end: number }[], pos: number): number {
  for (let i = 0; i < edges.length; i++) if (pos < (edges[i].start + edges[i].end) / 2) return i;
  return edges.length;
}

/** The index a row ends at when it is taken from `from` and inserted before the row that was at `insert`. */
export const landingIndex = (from: number, insert: number): number => (insert > from ? insert - 1 : insert);

/** Move the item at `from` so that it ends at index `to`. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const out = arr.slice();
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}

export function startReorder(e: RPointerEvent, opts: ReorderOptions): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if ((e.target as HTMLElement).closest(CONTROLS)) return;
  // a row inside a draggable block (a curve in a group): the innermost row takes the press
  const native = e.nativeEvent as PointerEvent & { reorderTaken?: boolean };
  if (native.reorderTaken) return;
  native.reorderTaken = true;
  const { scope, id, horizontal = false, onMove } = opts;
  const rows = () => [...document.querySelectorAll<HTMLElement>(`[data-reorder="${CSS.escape(scope)}"]`)];
  if (rows().length < 2) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let active = false;
  let insert = -1;
  let line: HTMLDivElement | null = null;
  let source: HTMLElement | null = null;
  let scroller: HTMLElement | null = null;
  let scrollBy = 0;
  let raf = 0;
  let last = { x: x0, y: y0 };

  const place = () => {
    const els = rows();
    const from = els.findIndex((el) => el.dataset.reorderId === id);
    if (from < 0 || !line) return;
    const rects = els.map((el) => el.getBoundingClientRect());
    const k = insertionIndex(rects.map((r) => (horizontal ? { start: r.left, end: r.right } : { start: r.top, end: r.bottom })), horizontal ? last.x : last.y);
    insert = k;
    // no line where dropping changes nothing
    if (landingIndex(from, k) === from) {
      line.style.display = "none";
      return;
    }
    const ref = rects[Math.min(k, rects.length - 1)];
    const before = k > 0 ? rects[k - 1] : null;
    const edge = horizontal
      ? k === rects.length ? ref.right : before ? (before.right + ref.left) / 2 : ref.left
      : k === rects.length ? ref.bottom : before ? (before.bottom + ref.top) / 2 : ref.top;
    line.style.display = "";
    if (horizontal) Object.assign(line.style, { left: `${edge - 1}px`, top: `${ref.top}px`, width: "2px", height: `${ref.height}px` });
    else Object.assign(line.style, { left: `${ref.left}px`, top: `${edge - 1}px`, width: `${ref.width}px`, height: "2px" });
  };
  const tick = () => {
    raf = 0;
    if (!scroller || !scrollBy) return;
    scroller.scrollTop += scrollBy;
    place();
    raf = requestAnimationFrame(tick);
  };
  const move = (ev: PointerEvent) => {
    last = { x: ev.clientX, y: ev.clientY };
    if (!active) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD_PX) return;
      active = true;
      source = rows().find((el) => el.dataset.reorderId === id) ?? null;
      source?.classList.add("reorder-source");
      scroller = horizontal ? null : scrollParent(source);
      document.body.classList.add("reordering");
      window.getSelection()?.removeAllRanges();
      line = document.createElement("div");
      line.className = "reorder-line";
      document.body.appendChild(line);
    }
    ev.preventDefault();
    // near the top or bottom edge of a long list: scroll it along
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      scrollBy = ev.clientY < r.top + EDGE_PX ? -8 : ev.clientY > r.bottom - EDGE_PX ? 8 : 0;
      if (scrollBy && !raf) raf = requestAnimationFrame(tick);
    }
    place();
  };
  const finish = (commit: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", cancel);
    if (raf) cancelAnimationFrame(raf);
    scrollBy = 0;
    if (!active) return;
    line?.remove();
    source?.classList.remove("reorder-source");
    document.body.classList.remove("reordering");
    // the release must not also count as a click on the row (only the click of this release: a later one is the user's)
    const released = performance.now();
    const stop = (ev: MouseEvent) => {
      if (performance.now() - released > 50) return;
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", stop, true), 0);
    if (!commit || insert < 0) return;
    const from = rows().findIndex((el) => el.dataset.reorderId === id);
    const to = landingIndex(from, insert);
    if (from >= 0 && to !== from) onMove(from, to);
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || !active) return;
    ev.stopPropagation();
    finish(false);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancel);
}

/** Props of a draggable row: `<div {...reorderRow(scope, id, onMove)}>`. */
export function reorderRow(scope: string, id: string, onMove: (from: number, to: number) => void, horizontal = false) {
  return {
    "data-reorder": scope,
    "data-reorder-id": id,
    onPointerDown: (e: RPointerEvent) => startReorder(e, { scope, id, horizontal, onMove }),
  };
}
