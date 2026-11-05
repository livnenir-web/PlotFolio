import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Graph, Layer, Selection, Shape, ShapeKind, TextItem } from "../model/types";
import type { InteractiveProps } from "./render/GraphSvg";
import { textItemBBox, type BBox } from "./layout";
import { pauseHistory, resumeHistory, useStore } from "../model/store";
import { uid, uniqueName } from "../model/defaults";
import { layoutGraph } from "./layout";
import { GraphSvg } from "./render/GraphSvg";
import { smoothPath } from "./paths";
import { PX_PER_MM_96, ptToMm } from "./units";
import { Icon } from "../ui/Icon";
import { useContextMenu, type MenuItem } from "../ui/ContextMenu";
import { useDialogs } from "../app/dialogs";
import { exportGraphAs } from "../export/exportGraph";
import { FitPanel } from "../fit/FitDialog";
import { Group, Panel, Separator } from "react-resizable-panels";
import { confirmDialog } from "../ui/confirm";
import { applyMarkupShortcut } from "../ui/markupKeys";
import { fileToDataUrl, insertImageIntoGraph, pickImageFile } from "../io/images";
import { importViaDialog } from "../io/importFiles";
import { goToDataSheet } from "../sheet/SheetView";
import { applyPlotStyle, copyPlotStyle, pastedPlotStyle, plotColumnIds } from "../model/figure";

type ShapeMm = { x1: number; y1: number; x2: number; y2: number };
/** Absolute start position of an object in canvas mm, for group moves (written back as start + delta). */
type ObjectSnap = { shape?: ShapeMm; text?: { x: number; y: number }; xy?: { x: number; y: number } };

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 10;
const SVG_STYLE = { display: "block", touchAction: "none" } as const;

/** Stable key of a movable object for groups: "layer:<id>", "shape:<layerId>:<id>", … (null for others). */
export function memberKey(sel: Selection): string | null {
  if (!("layerId" in sel)) return null;
  switch (sel.kind) {
    case "layer":
      return `layer:${sel.layerId}`;
    case "shape":
      return `shape:${sel.layerId}:${sel.shapeId}`;
    case "text":
      return `text:${sel.layerId}:${sel.textId}`;
    case "legend":
      return `legend:${sel.layerId}`;
    case "colorScale":
      return `colorScale:${sel.layerId}`;
    default:
      return null;
  }
}
function memberToSelection(key: string, graph: Graph): Selection | null {
  const [kind, layerId, objId] = key.split(":");
  const l = graph.layers.find((x) => x.id === layerId);
  if (!l) return null;
  const graphId = graph.id;
  if (kind === "layer") return { kind: "layer", graphId, layerId };
  if (kind === "shape") return l.shapes?.some((x) => x.id === objId) ? { kind: "shape", graphId, layerId, shapeId: objId } : null;
  if (kind === "text") return l.texts.some((x) => x.id === objId) ? { kind: "text", graphId, layerId, textId: objId } : null;
  if (kind === "legend") return { kind: "legend", graphId, layerId };
  if (kind === "colorScale") return l.colorScale ? { kind: "colorScale", graphId, layerId } : null;
  return null;
}
/** Pointer travel (screen px) below which a press counts as a click. */
const CLICK_PX = 3;
/** Drag kinds that only move things: previewed with an SVG transform, committed in one store write at release. */
const MOVE_KINDS = new Set(["layer", "legend", "colorScale", "text", "shape", "group"]);
/** setPointerCapture throws for synthetic events (benchmarks); capture is a nicety, not a requirement. */
function capturePointer(el: Element, pointerId: number) {
  try {
    (el as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(pointerId);
  } catch {
    /* ignore */
  }
}

interface InlineEdit {
  value: string;
  xPx: number;
  yPx: number;
  widthPx: number;
  fontPx: number;
  rotate?: number;
  commit: (v: string) => void;
}

type DragState =
  | { kind: "layer"; layerId: string; startX: number; startY: number; frame: Layer["frame"]; clickSelect?: Selection }
  | { kind: "resize"; layerId: string; corner: "nw" | "ne" | "sw" | "se"; startX: number; startY: number; frame: Layer["frame"] }
  | { kind: "legend"; layerId: string; startX: number; startY: number; x: number; y: number }
  | { kind: "colorScale"; layerId: string; startX: number; startY: number; x: number; y: number }
  | { kind: "text"; layerId: string; textId: string; startX: number; startY: number; x: number; y: number }
  | { kind: "zoomRect"; layerId: string; startX: number; startY: number; x1: number; y1: number }
  | { kind: "rotate"; layerId: string; startX: number; startY: number; az: number; el: number }
  | { kind: "shape"; layerId: string; shapeId: string; startX: number; startY: number; s: ShapeMm; shapeKind: ShapeKind }
  | { kind: "shapeHandle"; layerId: string; shapeId: string; handle: number; startX: number; startY: number; s: ShapeMm; shapeKind: ShapeKind; lockAspect?: boolean; pts?: { x: number; y: number }[] }
  | { kind: "cropHandle"; layerId: string; shapeId: string; side: "n" | "e" | "s" | "w"; startX: number; startY: number; s: ShapeMm; crop: { x: number; y: number; w: number; h: number } }
  | { kind: "draw"; tool: ShapeKind; layerId: string; startX: number; startY: number; x: number; y: number; trail?: { x: number; y: number }[] }
  | { kind: "group"; startX: number; startY: number; items: Selection[]; snaps: Map<string, ObjectSnap>; box: BBox | null }
  | { kind: "marquee"; startX: number; startY: number; clickSel?: Selection };

export function GraphView({ graph }: { graph: Graph }) {
  const sheets = useStore((s) => s.project.sheets); // layout depends on the graph and the sheets only
  const selection = useStore((s) => s.ui.selection);
  const zoomStored = useStore((s) => s.ui.zoom[graph.id]);
  const st = useStore;
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [edit, setEdit] = useState<InlineEdit | null>(null);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);
  const editRef = useRef<InlineEdit | null>(null);
  editRef.current = edit;
  /** Close the inline editor, saving the typed text unless `discard` (clicking elsewhere must not lose edits). */
  const closeEditor = useCallback((discard = false) => {
    const cur = editRef.current;
    if (cur && !discard && editInputRef.current) cur.commit(editInputRef.current.value);
    setEdit(null);
  }, []);
  const drag = useRef<DragState | null>(null);
  const [menu, openMenu] = useContextMenu();
  const rangePick = useDialogs((s) => s.rangePick);
  const cropShapeId = useDialogs((s) => s.cropShapeId);
  useEffect(() => {
    // crop mode belongs to one picture: leave it when the selection moves on
    if (cropShapeId && !(selection.kind === "shape" && selection.shapeId === cropShapeId)) useDialogs.getState().setCropShapeId(null);
  }, [selection, cropShapeId]);
  const fitDialog = useDialogs((s) => s.fitDialog);
  const [reader, setReader] = useState<{ xPx: number; yPx: number; text: string } | null>(null);
  const [zoomRect, setZoomRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [drawTool, setDrawTool] = useState<ShapeKind | null>(null);
  /** options applied to the next drawn shape: smoothing (0…1) of polylines/polygons, of the pen, and corner radius (mm) of rectangles */
  const [drawOpts, setDrawOpts] = useState({ smoothing: 0, freehand: 1, cornerMm: 0 });
  const drawOptsRef = useRef(drawOpts);
  drawOptsRef.current = drawOpts;
  const [drawPreview, setDrawPreview] = useState<{ tool: ShapeKind; x1: number; y1: number; x2: number; y2: number; trail?: { x: number; y: number }[] } | null>(null);
  /** polyline / polygon being placed click by click (double-click or Enter finishes, Esc cancels) */
  const [polyDraft, setPolyDraft] = useState<{ tool: "polyline" | "polygon"; layerId: string; points: { x: number; y: number }[]; cursor: { x: number; y: number } | null } | null>(null);
  const polyDraftRef = useRef(polyDraft);
  polyDraftRef.current = polyDraft;
  const finishPoly = useCallback(
    (commit: boolean) => {
      const d = polyDraftRef.current;
      if (d && commit && d.points.length >= (d.tool === "polygon" ? 3 : 2)) {
        const r1 = (v: number) => Math.round(v * 100) / 100;
        const pts = d.points.map((p) => ({ x: r1(p.x), y: r1(p.y) }));
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const sm = drawOptsRef.current.smoothing;
        const id = st.getState().addShape(graph.id, d.layerId, d.tool, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), { points: pts, smoothing: sm > 0 ? sm : undefined });
        st.getState().setSelection({ kind: "shape", graphId: graph.id, layerId: d.layerId, shapeId: id });
      }
      polyDraftRef.current = null;
      setPolyDraft(null);
      setDrawTool(null);
    },
    [graph.id, st],
  );
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** Import > Image…: pick a picture and place it on this graph (on the selected layer when there is one). */
  const importImageHere = useCallback(async () => {
    const img = await pickImageFile();
    if (!img) return;
    const sel = st.getState().ui.selection;
    await insertImageIntoGraph(graph.id, img.dataUrl, { layerId: "layerId" in sel ? sel.layerId : undefined, name: img.name });
  }, [graph.id, st]);
  /** L held: highlight layers and make clicks inside a frame pick the layer rather than objects on it */
  const [layerMode, setLayerMode] = useState(false);
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "l" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target) && st.getState().ui.activeTab?.id === graph.id) {
        e.preventDefault();
        setLayerMode(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "l") setLayerMode(false);
    };
    const blur = () => setLayerMode(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [graph.id, st]);
  /** additional objects selected with shift+click (the primary one is ui.selection) */
  /** additional selected objects: kept in the store so the inspector can edit all of them at once */
  const multi = useStore((s) => s.ui.multi);
  const setMulti = useCallback((v: Selection[] | ((m: Selection[]) => Selection[])) => st.getState().setMulti(typeof v === "function" ? v(st.getState().ui.multi) : v), [st]);
  const prevSelection = useRef<Selection>(selection);
  useEffect(() => {
    // a plain selection change (not via shift) clears the multi-selection
    if (prevSelection.current !== selection && !shiftSelecting.current) setMulti([]);
    prevSelection.current = selection;
    shiftSelecting.current = false;
  }, [selection]);
  const shiftSelecting = useRef(false);
  const [pickDrag, setPickDrag] = useState<{ x0: number; x1: number } | null>(null);

  const layout = useMemo(() => layoutGraph(st.getState().project, graph), [sheets, graph, st]);
  const frozenSize = useRef<{ w: number; h: number } | null>(null);
  const zoom = zoomStored ?? 0;
  const pxPerMm = PX_PER_MM_96 * (zoom || 1);
  const pxPerMmRef = useRef(pxPerMm);
  pxPerMmRef.current = pxPerMm;

  // initial zoom: fit the canvas into the viewport
  useLayoutEffect(() => {
    if (zoomStored) return;
    const el = scrollRef.current;
    if (!el) return;
    const z = Math.min((el.clientWidth - 48) / (layout.widthMm * PX_PER_MM_96), (el.clientHeight - 48) / (layout.heightMm * PX_PER_MM_96));
    st.getState().setZoom(graph.id, Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(z * 10) / 10)));
  }, [zoomStored, graph.id, layout.widthMm, layout.heightMm, st]);

  const setZoom = useCallback(
    (z: number) => st.getState().setZoom(graph.id, Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(z.toFixed(2))))),
    [graph.id, st],
  );
  const zoomFit = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const z = Math.min((el.clientWidth - 48) / (layout.widthMm * PX_PER_MM_96), (el.clientHeight - 48) / (layout.heightMm * PX_PER_MM_96));
    setZoom(Math.floor(z * 20) / 20);
  }, [layout.widthMm, layout.heightMm, setZoom]);

  /**
   * Inverse screen matrix of the SVG, cached between pointer events. During a gesture it is kept from the
   * press, so a layout shift elsewhere (a panel or the inspector changing size) is not mistaken for pointer
   * movement. It is refreshed on scroll, zoom and when the view resizes while no gesture is active.
   */
  const ctmRef = useRef<DOMMatrix | null>(null);
  const toMm = useCallback((e: { clientX: number; clientY: number }): [number, number] => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    let inv = ctmRef.current;
    if (!inv) {
      const ctm = svg.getScreenCTM();
      if (!ctm) return [0, 0];
      inv = ctm.inverse();
      ctmRef.current = inv;
    }
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(inv);
    return [p.x, p.y];
  }, []);
  useEffect(() => {
    ctmRef.current = null;
  }, [pxPerMm]);
  useEffect(() => {
    const el = scrollRef.current;
    const clear = () => void (ctmRef.current = null);
    const clearIfIdle = () => {
      if (!drag.current) ctmRef.current = null;
    };
    el?.addEventListener("scroll", clear);
    window.addEventListener("resize", clear);
    const ro = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(clearIfIdle) : null;
    if (el) ro?.observe(el);
    return () => {
      el?.removeEventListener("scroll", clear);
      window.removeEventListener("resize", clear);
      ro?.disconnect();
    };
  }, []);

  // Drag preview: during a move drag the affected SVG groups get a translate() transform and nothing is
  // written to the store, so no layout or React render happens per pointer move.
  const previewRef = useRef<Element[] | null>(null);
  const layerHandlesRef = useRef<SVGGElement>(null);
  const shapeHandlesRef = useRef<SVGGElement>(null);
  const applyPreview = (dx: number, dy: number) => {
    const t = dx || dy ? `translate(${dx} ${dy})` : null;
    for (const el of previewRef.current ?? []) {
      if (t) el.setAttribute("transform", t);
      else el.removeAttribute("transform");
    }
  };
  const clearPreview = () => {
    for (const el of previewRef.current ?? []) el.removeAttribute("transform");
    previewRef.current = null;
  };

  const select = useCallback((sel: Selection) => st.getState().setSelection(sel), [st]);

  /** Write a shape's position given in canvas mm, converting to axis units when the shape is attached to the axes. */
  const writeShape = useCallback(
    (layerId: string, shapeId: string, mm: ShapeMm) => {
      const ll = layout.layers.find((x) => x.layer.id === layerId);
      const r1 = (v: number) => Math.round(v * 10) / 10;
      st.getState().updateShape(graph.id, layerId, shapeId, (sh) => {
        if (sh.points) {
          // vertices follow the box: moved, or stretched when the box changed size
          const old = ll?.shapeMm.get(shapeId);
          const pts = ll?.shapePointsMm.get(shapeId);
          if (!old || !pts) return;
          const ow = old.x2 - old.x1 || 1;
          const oh = old.y2 - old.y1 || 1;
          const sx = (mm.x2 - mm.x1) / ow;
          const sy = (mm.y2 - mm.y1) / oh;
          const moved = pts.map((p) => ({ x: mm.x1 + (p.x - old.x1) * sx, y: mm.y1 + (p.y - old.y1) * sy }));
          setPoints(sh, moved, ll);
          return;
        }
        if (sh.coord === "data" && ll) {
          const a = ll.toData(mm.x1, mm.y1);
          const b = ll.toData(mm.x2, mm.y2);
          sh.x1 = a.x;
          sh.y1 = a.y;
          sh.x2 = b.x;
          sh.y2 = b.y;
        } else {
          sh.x1 = r1(mm.x1);
          sh.y1 = r1(mm.y1);
          sh.x2 = r1(mm.x2);
          sh.y2 = r1(mm.y2);
        }
      });
    },
    [graph.id, layout, st],
  );
  const writeText = useCallback(
    (layerId: string, textId: string, xMm: number, yMm: number) => {
      const ll = layout.layers.find((x) => x.layer.id === layerId);
      const r1 = (v: number) => Math.round(v * 10) / 10;
      st.getState().updateLayer(graph.id, layerId, (l) => {
        const t = l.texts.find((x) => x.id === textId);
        if (!t) return;
        if (t.coord === "data" && ll) {
          const p = ll.toData(xMm, yMm);
          t.xMm = p.x;
          t.yMm = p.y;
        } else {
          t.xMm = r1(xMm);
          t.yMm = r1(yMm);
        }
      });
    },
    [graph.id, layout, st],
  );
  /** Store vertices given in canvas mm (converted to axis units for attached shapes) and refresh the box. */
  const setPoints = (sh: Shape, ptsMm: { x: number; y: number }[], ll?: { toData: (x: number, y: number) => { x: number; y: number } }) => {
    const r1 = (v: number) => Math.round(v * 100) / 100;
    const conv = (p: { x: number; y: number }) => (sh.coord === "data" && ll ? ll.toData(p.x, p.y) : { x: r1(p.x), y: r1(p.y) });
    sh.points = ptsMm.map(conv);
    const xs = sh.points.map((p) => p.x);
    const ys = sh.points.map((p) => p.y);
    sh.x1 = Math.min(...xs);
    sh.y1 = Math.min(...ys);
    sh.x2 = Math.max(...xs);
    sh.y2 = Math.max(...ys);
  };
  const writeShapePoints = useCallback(
    (layerId: string, shapeId: string, ptsMm: { x: number; y: number }[]) => {
      const ll = layout.layers.find((x) => x.layer.id === layerId);
      st.getState().updateShape(graph.id, layerId, shapeId, (sh) => setPoints(sh, ptsMm, ll));
    },
    [graph.id, layout, st],
  );
  const shapeMmOf = useCallback(
    (layerId: string, shapeId: string): ShapeMm | undefined => layout.layers.find((x) => x.layer.id === layerId)?.shapeMm.get(shapeId),
    [layout],
  );
  const textMmOf = useCallback(
    (layerId: string, textId: string): { x: number; y: number } | undefined => layout.layers.find((x) => x.layer.id === layerId)?.textMm.get(textId),
    [layout],
  );

  /** Bounding box (canvas mm) of a movable object. */
  const bboxOf = useCallback(
    (it: Selection): BBox | null => {
      if (!("layerId" in it)) return null;
      const ll = layout.layers.find((x) => x.layer.id === it.layerId);
      if (!ll) return null;
      const f = ll.layer.frame;
      if (it.kind === "layer") return { x0: f.xMm, y0: f.yMm, x1: f.xMm + f.wMm, y1: f.yMm + f.hMm };
      if (it.kind === "shape") {
        const sh = ll.shapeMm.get(it.shapeId);
        return sh ? { x0: Math.min(sh.x1, sh.x2), y0: Math.min(sh.y1, sh.y2), x1: Math.max(sh.x1, sh.x2), y1: Math.max(sh.y1, sh.y2) } : null;
      }
      if (it.kind === "text") {
        const t = ll.layer.texts.find((x) => x.id === it.textId);
        const pos = ll.textMm.get(it.textId);
        return t && pos ? textItemBBox({ ...t, xMm: pos.x, yMm: pos.y }) : null;
      }
      if (it.kind === "legend") return { x0: ll.legend.x, y0: ll.legend.y, x1: ll.legend.x + ll.legend.w, y1: ll.legend.y + ll.legend.h };
      if (it.kind === "colorScale" && ll.colorScale) return { x0: ll.colorScale.x, y0: ll.colorScale.y, x1: ll.colorScale.x + ll.colorScale.w, y1: ll.colorScale.y + ll.colorScale.h };
      return null;
    },
    [layout],
  );

  /** Move an object so that its bounding box's top-left lands at (x0, y0). */
  const moveObjectTo = useCallback(
    (it: Selection, x0: number, y0: number) => {
      const b = bboxOf(it);
      if (!b || !("layerId" in it)) return;
      const dx = Math.round((x0 - b.x0) * 10) / 10;
      const dy = Math.round((y0 - b.y0) * 10) / 10;
      if (!dx && !dy) return;
      if (it.kind === "shape") {
        const m = shapeMmOf(it.layerId, it.shapeId);
        if (m) writeShape(it.layerId, it.shapeId, { x1: m.x1 + dx, y1: m.y1 + dy, x2: m.x2 + dx, y2: m.y2 + dy });
        return;
      }
      if (it.kind === "text") {
        const m = textMmOf(it.layerId, it.textId);
        if (m) writeText(it.layerId, it.textId, m.x + dx, m.y + dy);
        return;
      }
      st.getState().updateLayer(graph.id, it.layerId, (l) => {
        if (it.kind === "layer") {
          l.frame.xMm += dx;
          l.frame.yMm += dy;
        } else if (it.kind === "legend") {
          l.legend.xMm += dx;
          l.legend.yMm += dy;
        } else if (it.kind === "colorScale" && l.colorScale) {
          l.colorScale.xMm += dx;
          l.colorScale.yMm += dy;
        }
      });
    },
    [bboxOf, graph.id, st, shapeMmOf, textMmOf, writeShape, writeText],
  );

  /** Snapshot an object's position (canvas mm) at the start of a group drag. */
  const snapshotObject = useCallback(
    (it: Selection): ObjectSnap | null => {
      if (!("layerId" in it)) return null;
      const l = layerById(it.layerId);
      if (!l) return null;
      if (it.kind === "shape") {
        const m = shapeMmOf(it.layerId, it.shapeId);
        return m ? { shape: { ...m } } : null;
      }
      if (it.kind === "text") {
        const m = textMmOf(it.layerId, it.textId);
        return m ? { text: { ...m } } : null;
      }
      if (it.kind === "layer") return { xy: { x: l.frame.xMm, y: l.frame.yMm } };
      if (it.kind === "legend") return { xy: { x: l.legend.xMm, y: l.legend.yMm } };
      if (it.kind === "colorScale" && l.colorScale) return { xy: { x: l.colorScale.xMm, y: l.colorScale.yMm } };
      return null;
    },
    [graph.layers, shapeMmOf, textMmOf],
  );

  /** Place several objects in ONE store update (so a group move is a single undo step). */
  const placeObjects = useCallback(
    (items: Selection[], snaps: Map<string, ObjectSnap>, dx0: number, dy0: number, perItem?: Map<string, { dx: number; dy: number }>) => {
      const r1 = (v: number) => Math.round(v * 10) / 10;
      const groupLayers = new Set(items.filter((i) => i.kind === "layer").map((i) => (i as { layerId: string }).layerId));
      st.getState().updateGraph(graph.id, (g) => {
        for (const it of items) {
          const key = JSON.stringify(it);
          const sn = snaps.get(key);
          if (!sn || !("layerId" in it)) continue;
          const { dx, dy } = perItem?.get(key) ?? { dx: dx0, dy: dy0 };
          const l = g.layers.find((x) => x.id === it.layerId);
          const ll = layout.layers.find((x) => x.layer.id === it.layerId);
          if (!l) continue;
          if (it.kind === "shape" && sn.shape) {
            const sh = l.shapes?.find((x) => x.id === it.shapeId);
            if (!sh) continue;
            if (sh.coord === "data" && groupLayers.has(it.layerId)) continue; // follows its layer's axes
            const mm = { x1: sn.shape.x1 + dx, y1: sn.shape.y1 + dy, x2: sn.shape.x2 + dx, y2: sn.shape.y2 + dy };
            if (sh.points) {
              const pts = ll?.shapePointsMm.get(sh.id);
              if (pts) setPoints(sh, pts.map((p) => ({ x: p.x + dx, y: p.y + dy })), ll);
              continue;
            }
            if (sh.coord === "data" && ll) {
              const a = ll.toData(mm.x1, mm.y1);
              const b = ll.toData(mm.x2, mm.y2);
              Object.assign(sh, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
            } else Object.assign(sh, { x1: r1(mm.x1), y1: r1(mm.y1), x2: r1(mm.x2), y2: r1(mm.y2) });
          } else if (it.kind === "text" && sn.text) {
            const t = l.texts.find((x) => x.id === it.textId);
            if (!t) continue;
            if (t.coord === "data" && groupLayers.has(it.layerId)) continue;
            if (t.coord === "data" && ll) {
              const p = ll.toData(sn.text.x + dx, sn.text.y + dy);
              t.xMm = p.x;
              t.yMm = p.y;
            } else {
              t.xMm = r1(sn.text.x + dx);
              t.yMm = r1(sn.text.y + dy);
            }
          } else if (sn.xy) {
            if ((it.kind === "legend" || it.kind === "colorScale") && groupLayers.has(it.layerId)) continue; // moves with its layer's frame
            const x = r1(sn.xy.x + dx);
            const y = r1(sn.xy.y + dy);
            if (it.kind === "layer") {
              l.frame.xMm = x;
              l.frame.yMm = y;
            } else if (it.kind === "legend") {
              l.legend.xMm = x;
              l.legend.yMm = y;
            } else if (it.kind === "colorScale" && l.colorScale) {
              l.colorScale.xMm = x;
              l.colorScale.yMm = y;
            }
          }
        }
      });
    },
    [graph.id, st, layout],
  );

  const [gridCols, setGridCols] = useState(2);
  const [gridGap, setGridGap] = useState(5);
  /** Lay the selection out on a grid (reading order), starting at the selection's top-left corner, in one undo step. */
  const arrangeGrid = () => {
    const all = [st.getState().ui.selection, ...multi];
    const selLayers = new Set(all.filter((x) => x.kind === "layer").map((x) => (x as { layerId: string }).layerId));
    const follows = (it: Selection) => {
      if (!("layerId" in it) || !selLayers.has(it.layerId)) return false;
      if (it.kind === "legend" || it.kind === "colorScale") return true;
      const l = layerById(it.layerId);
      if (it.kind === "shape") return l?.shapes?.find((x) => x.id === it.shapeId)?.coord === "data";
      if (it.kind === "text") return l?.texts.find((x) => x.id === it.textId)?.coord === "data";
      return false;
    };
    const items = all.filter((it) => "layerId" in it && !follows(it));
    const boxes = items.map((it) => ({ it, b: bboxOf(it) })).filter((x): x is { it: Selection; b: BBox } => !!x.b);
    if (boxes.length < 2) return;
    const cols = Math.max(1, Math.min(boxes.length, Math.round(gridCols)));
    const sorted = [...boxes].sort((a, b) => a.b.y0 - b.b.y0 || a.b.x0 - b.b.x0);
    const x0 = Math.min(...sorted.map((x) => x.b.x0));
    const y0 = Math.min(...sorted.map((x) => x.b.y0));
    const rows = Math.ceil(sorted.length / cols);
    const colW = Array.from({ length: cols }, (_, c) => Math.max(...sorted.filter((_, i) => i % cols === c).map((x) => x.b.x1 - x.b.x0)));
    const rowH = Array.from({ length: rows }, (_, rI) => Math.max(...sorted.filter((_, i) => Math.floor(i / cols) === rI).map((x) => x.b.y1 - x.b.y0)));
    const snaps = new Map<string, ObjectSnap>();
    const deltas = new Map<string, { dx: number; dy: number }>();
    sorted.forEach(({ it, b }, i) => {
      const c = i % cols;
      const rI = Math.floor(i / cols);
      const tx = x0 + colW.slice(0, c).reduce((s, w) => s + w + gridGap, 0);
      const ty = y0 + rowH.slice(0, rI).reduce((s, h) => s + h + gridGap, 0);
      const sn = snapshotObject(it);
      if (!sn) return;
      const key = JSON.stringify(it);
      snaps.set(key, sn);
      deltas.set(key, { dx: Math.round((tx - b.x0) * 10) / 10, dy: Math.round((ty - b.y0) * 10) / 10 });
    });
    placeObjects(items, snaps, 0, 0, deltas);
  };

  type AlignOp = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "distributeH" | "distributeV" | "sameSize";
  const alignSelected = (op: AlignOp) => {
    const picked = [st.getState().ui.selection, ...multi];
    const selLayers = new Set(picked.filter((x) => x.kind === "layer").map((x) => (x as { layerId: string }).layerId));
    const followsLayer = (it: Selection) => {
      if (!("layerId" in it) || !selLayers.has(it.layerId)) return false;
      if (it.kind === "legend" || it.kind === "colorScale") return true;
      const l = layerById(it.layerId);
      if (it.kind === "shape") return l?.shapes?.find((x) => x.id === it.shapeId)?.coord === "data";
      if (it.kind === "text") return l?.texts.find((x) => x.id === it.textId)?.coord === "data";
      return false;
    };
    const items = picked.filter((it) => !followsLayer(it));
    const boxes = items.map((it) => ({ it, b: bboxOf(it) })).filter((x): x is { it: Selection; b: BBox } => !!x.b);
    if (boxes.length < 2) return;
    const all = { x0: Math.min(...boxes.map((x) => x.b.x0)), y0: Math.min(...boxes.map((x) => x.b.y0)), x1: Math.max(...boxes.map((x) => x.b.x1)), y1: Math.max(...boxes.map((x) => x.b.y1)) };
    if (op === "sameSize") {
      const ref = boxes[0];
      const w = ref.b.x1 - ref.b.x0;
      const h = ref.b.y1 - ref.b.y0;
      for (const { it } of boxes.slice(1)) {
        if (!("layerId" in it)) continue;
        st.getState().updateLayer(graph.id, it.layerId, (l) => {
          if (it.kind === "layer") {
            l.frame.wMm = w;
            l.frame.hMm = h;
          }
        });
        if (it.kind === "shape") {
          const m = shapeMmOf(it.layerId, it.shapeId);
          if (m) writeShape(it.layerId, it.shapeId, { x1: m.x1, y1: m.y1, x2: m.x1 + Math.sign(m.x2 - m.x1 || 1) * w, y2: m.y1 + Math.sign(m.y2 - m.y1 || 1) * h });
        }
      }
      return;
    }
    if (op === "distributeH" || op === "distributeV") {
      const horiz = op === "distributeH";
      const sorted = [...boxes].sort((a, b) => (horiz ? a.b.x0 - b.b.x0 : a.b.y0 - b.b.y0));
      const total = horiz ? all.x1 - all.x0 : all.y1 - all.y0;
      const sizes = sorted.reduce((s, x) => s + (horiz ? x.b.x1 - x.b.x0 : x.b.y1 - x.b.y0), 0);
      const gap = (total - sizes) / (sorted.length - 1);
      let pos = horiz ? all.x0 : all.y0;
      for (const { it, b } of sorted) {
        if (horiz) moveObjectTo(it, pos, b.y0);
        else moveObjectTo(it, b.x0, pos);
        pos += (horiz ? b.x1 - b.x0 : b.y1 - b.y0) + gap;
      }
      return;
    }
    // anchor: the first selected object (the primary selection) stays put; the others align to it
    const ref = boxes[0].b;
    const cx = (ref.x0 + ref.x1) / 2;
    const cy = (ref.y0 + ref.y1) / 2;
    for (const { it, b } of boxes.slice(1)) {
      const w = b.x1 - b.x0;
      const h = b.y1 - b.y0;
      switch (op) {
        case "left":
          moveObjectTo(it, ref.x0, b.y0);
          break;
        case "right":
          moveObjectTo(it, ref.x1 - w, b.y0);
          break;
        case "hcenter":
          moveObjectTo(it, cx - w / 2, b.y0);
          break;
        case "top":
          moveObjectTo(it, b.x0, ref.y0);
          break;
        case "bottom":
          moveObjectTo(it, b.x0, ref.y1 - h);
          break;
        case "vcenter":
          moveObjectTo(it, b.x0, cy - h / 2);
          break;
      }
    }
  };

  const layerById = (id: string) => graph.layers.find((l) => l.id === id);

  /** Members of the group an object belongs to, resolved to existing objects (null when not grouped). */
  const groupMembersOf = (sel: Selection): { groupId: string; members: Selection[] } | null => {
    const key = memberKey(sel);
    if (!key) return null;
    const gr = graph.groups?.find((g) => g.members.includes(key));
    if (!gr) return null;
    const members = gr.members.map((m) => memberToSelection(m, graph)).filter((x): x is Selection => !!x);
    return members.length > 1 ? { groupId: gr.id, members } : null;
  };
  const groupSelection = () => {
    const keys = [st.getState().ui.selection, ...multi].map(memberKey).filter((k): k is string => !!k);
    if (keys.length < 2) return;
    st.getState().groupObjects(graph.id, keys);
    useDialogs.getState().showToast(`${keys.length} objects grouped`);
  };
  const ungroupSelection = () => {
    const gr = groupMembersOf(st.getState().ui.selection);
    if (gr) st.getState().ungroupObjects(graph.id, gr.groupId);
  };

  /** SVG elements to translate while previewing a move of these objects (see LayerG's data-drag groups). */
  const previewTargets = (items: Selection[]): Element[] => {
    const svg = svgRef.current;
    const out = new Set<Element>();
    if (!svg) return [];
    const q = (selector: string) => svg.querySelectorAll(selector).forEach((el) => out.add(el));
    const primary = st.getState().ui.selection;
    const groupLayers = new Set(items.filter((i) => i.kind === "layer").map((i) => (i as { layerId: string }).layerId));
    for (const it of items) {
      if (!("layerId" in it)) continue;
      const l = layerById(it.layerId);
      if (it.kind === "layer") {
        q(`[data-drag="frame:${it.layerId}"]`);
        // objects attached to the axes follow the frame; mm-positioned ones stay where they are
        for (const sh of l?.shapes ?? []) if (sh.coord === "data") q(`[data-layer-id="${it.layerId}"] [data-shape-id="${sh.id}"]`);
        for (const t of l?.texts ?? []) if (t.coord === "data") q(`[data-layer-id="${it.layerId}"] [data-text-id="${t.id}"]`);
        if (primary.kind === "layer" && primary.layerId === it.layerId && layerHandlesRef.current) out.add(layerHandlesRef.current);
      } else if (it.kind === "legend") {
        if (!groupLayers.has(it.layerId)) q(`[data-drag="legend:${it.layerId}"]`); // otherwise it moves inside the frame group
      } else if (it.kind === "colorScale") {
        if (!groupLayers.has(it.layerId)) q(`[data-drag="colorScale:${it.layerId}"]`);
      } else if (it.kind === "shape") {
        const sh = l?.shapes?.find((x) => x.id === it.shapeId);
        if (sh?.coord === "data" && groupLayers.has(it.layerId)) continue; // already moves with its layer
        q(`[data-layer-id="${it.layerId}"] [data-shape-id="${it.shapeId}"]`);
        if (primary.kind === "shape" && primary.shapeId === it.shapeId && shapeHandlesRef.current) out.add(shapeHandlesRef.current);
      } else if (it.kind === "text") {
        const t = l?.texts.find((x) => x.id === it.textId);
        if (t?.coord === "data" && groupLayers.has(it.layerId)) continue;
        q(`[data-layer-id="${it.layerId}"] [data-text-id="${it.textId}"]`);
      }
    }
    return [...out];
  };

  const onPointerDown = useCallback(
    (sel: Selection, e: React.PointerEvent<SVGElement>) => {
      if (e.button !== 0) {
        select(sel);
        return;
      }
      e.stopPropagation();
      closeEditor();
      ctmRef.current = null; // measure the press against the current paper position, then keep it for the gesture
      const [mx, my] = toMm(e);
      const l = "layerId" in sel ? layerById(sel.layerId) : undefined;
      if (sel.kind === "canvas" || (e.metaKey && !e.altKey)) {
        // rubber-band selection: on empty canvas, or anywhere with ⌘ held
        if (sel.kind === "canvas") {
          select(sel);
          setMulti([]);
        }
        drag.current = { kind: "marquee", startX: mx, startY: my, clickSel: sel.kind === "canvas" ? undefined : sel };
        frozenSize.current = { w: layout.widthMm, h: layout.heightMm };
        capturePointer(e.currentTarget, e.pointerId);
        return;
      }
      const movable = (x: Selection) => x.kind === "layer" || x.kind === "shape" || x.kind === "text" || x.kind === "legend" || x.kind === "colorScale";
      if (layerMode && sel.kind === "layer" && !e.shiftKey) {
        // layer mode: plain clicks accumulate layers; clicking an already selected layer drags the selection
        const cur = st.getState().ui.selection;
        const keys = new Set([cur, ...multi].map((x) => JSON.stringify(x)));
        if (!keys.has(JSON.stringify(sel))) {
          if (cur.kind === "layer") {
            shiftSelecting.current = true;
            setMulti((m) => [...m, sel]);
          } else select(sel);
          return;
        }
      }
      if (e.shiftKey && movable(sel) && movable(st.getState().ui.selection)) {
        // shift+click: toggle in the multi-selection
        const cur = st.getState().ui.selection;
        const key = (x: Selection) => JSON.stringify(x);
        if (key(cur) === key(sel)) return;
        shiftSelecting.current = true;
        setMulti((m) => (m.some((x) => key(x) === key(sel)) ? m.filter((x) => key(x) !== key(sel)) : [...m, sel]));
        return;
      }
      let curMulti = multi;
      const grp = !e.shiftKey && !layerMode && movable(sel) ? groupMembersOf(sel) : null;
      if (grp) {
        // a grouped object: the whole group is selected and moves together
        const k = JSON.stringify(sel);
        const others = grp.members.filter((m) => JSON.stringify(m) !== k);
        shiftSelecting.current = true;
        select(sel);
        setMulti(others);
        curMulti = others;
      }
      const groupKeys = new Set([grp ? sel : st.getState().ui.selection, ...curMulti].map((x) => JSON.stringify(x)));
      if (curMulti.length > 0 && groupKeys.has(JSON.stringify(sel)) && movable(sel)) {
        // drag the whole multi-selection together
        const items = [grp ? sel : st.getState().ui.selection, ...curMulti];
        const snaps = new Map<string, ObjectSnap>();
        for (const it of items) {
          const sn = snapshotObject(it);
          if (sn) snaps.set(JSON.stringify(it), sn);
        }
        const boxes = items.map((it) => bboxOf(it)).filter((b): b is BBox => !!b);
        const box = boxes.length ? { x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)) } : null;
        drag.current = { kind: "group", startX: mx, startY: my, items, snaps, box };
        frozenSize.current = { w: layout.widthMm, h: layout.heightMm };
        capturePointer(e.currentTarget, e.pointerId);
        previewRef.current = previewTargets(items);
        return;
      }
      if (sel.kind === "shape" && l) {
        const shp = l.shapes?.find((x) => x.id === sel.shapeId);
        const mm = shapeMmOf(l.id, sel.shapeId);
        if (shp && mm) {
          select(sel);
          drag.current = { kind: "shape", layerId: l.id, shapeId: shp.id, startX: mx, startY: my, s: { ...mm }, shapeKind: shp.kind };
          frozenSize.current = { w: layout.widthMm, h: layout.heightMm };
          capturePointer(e.currentTarget, e.pointerId);
          // the handles are rendered after this selection change; resolve the targets once that happened
          const items: Selection[] = [sel];
          queueMicrotask(() => void (drag.current?.kind === "shape" && (previewRef.current = previewTargets(items))));
          return;
        }
      }
      if (e.altKey && l) {
        // ⌥-drag: rubber-band zoom on 2D layers, rotate on 3D layers
        if (l.view3d) drag.current = { kind: "rotate", layerId: l.id, startX: mx, startY: my, az: l.view3d.azimuth, el: l.view3d.elevation };
        else drag.current = { kind: "zoomRect", layerId: l.id, startX: mx, startY: my, x1: mx, y1: my };
        frozenSize.current = { w: layout.widthMm, h: layout.heightMm };
        capturePointer(e.currentTarget, e.pointerId);
        pauseHistory();
        return;
      }
      const cur = st.getState().ui.selection;
      // With the layer already selected, dragging on its plots or axes moves the layer; a plain click still selects the element.
      if (l && (sel.kind === "plot" || sel.kind === "axis") && cur.kind === "layer" && cur.layerId === l.id) {
        drag.current = { kind: "layer", layerId: l.id, startX: mx, startY: my, frame: { ...l.frame }, clickSelect: sel };
        frozenSize.current = { w: layout.widthMm, h: layout.heightMm };
        capturePointer(e.currentTarget, e.pointerId);
        previewRef.current = previewTargets([{ kind: "layer", graphId: graph.id, layerId: l.id }]);
        return;
      }
      select(sel);
      if (sel.kind === "layer" && l) drag.current = { kind: "layer", layerId: l.id, startX: mx, startY: my, frame: { ...l.frame } };
      else if (sel.kind === "legend" && l) drag.current = { kind: "legend", layerId: l.id, startX: mx, startY: my, x: l.legend.xMm, y: l.legend.yMm };
      else if (sel.kind === "colorScale" && l && l.colorScale) drag.current = { kind: "colorScale", layerId: l.id, startX: mx, startY: my, x: l.colorScale.xMm, y: l.colorScale.yMm };
      else if (sel.kind === "text" && l) {
        const t = l.texts.find((x) => x.id === sel.textId);
        const pos = textMmOf(l.id, sel.textId);
        if (t && pos) drag.current = { kind: "text", layerId: l.id, textId: t.id, startX: mx, startY: my, x: pos.x, y: pos.y };
      } else return;
      frozenSize.current = { w: layout.widthMm, h: layout.heightMm };
      capturePointer(e.currentTarget, e.pointerId);
      // targets are resolved after React has rendered the new selection (handles, outline)
      const started = drag.current;
      queueMicrotask(() => void (drag.current === started && (previewRef.current = previewTargets([sel]))));
    },
    [select, toMm, graph.layers, st, layout.widthMm, layout.heightMm, multi, snapshotObject, shapeMmOf, textMmOf, layerMode],
  );

  const startShapeHandle = useCallback(
    (layerId: string, shapeId: string, handle: number, e: React.PointerEvent<SVGElement>) => {
      e.stopPropagation();
      const shp = layerById(layerId)?.shapes?.find((x) => x.id === shapeId);
      const mm = shapeMmOf(layerId, shapeId);
      if (!shp || !mm) return;
      ctmRef.current = null;
      const [mx, my] = toMm(e);
      const pts = shp.points ? layout.layers.find((x) => x.layer.id === layerId)?.shapePointsMm.get(shapeId)?.map((p) => ({ ...p })) : undefined;
      // pictures keep their proportions unless ⌥ is held
      drag.current = { kind: "shapeHandle", layerId, shapeId, handle, startX: mx, startY: my, s: { ...mm }, shapeKind: shp.kind, lockAspect: shp.kind === "image" && shp.lockAspect !== false && !e.altKey, pts };
      frozenSize.current = { w: layout.widthMm, h: layout.heightMm };
      capturePointer(e.currentTarget, e.pointerId);
      pauseHistory();
    },
    [toMm, graph.layers, layout, shapeMmOf],
  );

  /** Crop mode: dragging an edge of a picture trims it; the rest of the picture stays where it is. */
  const startCropHandle = useCallback(
    (layerId: string, shapeId: string, side: "n" | "e" | "s" | "w", e: React.PointerEvent<SVGElement>) => {
      e.stopPropagation();
      const shp = layerById(layerId)?.shapes?.find((x) => x.id === shapeId);
      const mm = shapeMmOf(layerId, shapeId);
      if (!shp || !mm) return;
      ctmRef.current = null;
      const [mx, my] = toMm(e);
      drag.current = { kind: "cropHandle", layerId, shapeId, side, startX: mx, startY: my, s: { ...mm }, crop: { ...(shp.crop ?? { x: 0, y: 0, w: 1, h: 1 }) } };
      frozenSize.current = { w: layout.widthMm, h: layout.heightMm };
      capturePointer(e.currentTarget, e.pointerId);
      pauseHistory();
    },
    [toMm, graph.layers, layout.widthMm, layout.heightMm, shapeMmOf],
  );

  const startDraw = useCallback(
    (e: React.PointerEvent) => {
      if (!drawTool) return;
      e.stopPropagation();
      ctmRef.current = null;
      const [mx, my] = toMm(e);
      const sel = st.getState().ui.selection;
      const layerId = ("layerId" in sel ? sel.layerId : undefined) ?? graph.layers[0]?.id;
      if (!layerId) return;
      if (drawTool === "polyline" || drawTool === "polygon") {
        // click by click; a click back on the first point closes a polygon
        if (e.detail > 1) return; // the double-click handler finishes
        const d = polyDraftRef.current;
        if (!d) {
          const nd = { tool: drawTool, layerId, points: [{ x: mx, y: my }], cursor: { x: mx, y: my } };
          polyDraftRef.current = nd;
          setPolyDraft(nd);
          return;
        }
        const first = d.points[0];
        if (d.tool === "polygon" && d.points.length >= 3 && Math.hypot(mx - first.x, my - first.y) * pxPerMm < 8) {
          finishPoly(true);
          return;
        }
        const nd = { ...d, points: [...d.points, { x: mx, y: my }] };
        polyDraftRef.current = nd;
        setPolyDraft(nd);
        return;
      }
      drag.current = { kind: "draw", tool: drawTool, layerId, startX: mx, startY: my, x: mx, y: my, trail: drawTool === "freehand" ? [{ x: mx, y: my }] : undefined };
      frozenSize.current = { w: layout.widthMm, h: layout.heightMm };
      capturePointer(e.currentTarget, e.pointerId);
    },
    [drawTool, toMm, graph.layers, st, layout.widthMm, layout.heightMm, pxPerMm, finishPoly],
  );

  const startResize = useCallback(
    (layerId: string, corner: "nw" | "ne" | "sw" | "se", e: React.PointerEvent<SVGElement>) => {
      e.stopPropagation();
      const l = layerById(layerId);
      if (!l) return;
      ctmRef.current = null;
      const [mx, my] = toMm(e);
      drag.current = { kind: "resize", layerId, corner, startX: mx, startY: my, frame: { ...l.frame } };
      frozenSize.current = { w: layout.widthMm, h: layout.heightMm };
      capturePointer(e.currentTarget, e.pointerId);
      pauseHistory();
    },
    [toMm, graph.layers, layout.widthMm, layout.heightMm],
  );

  /** Alignment guides shown while something is dragged (canvas mm). */
  const [guides, setGuides] = useState<{ xs: number[]; ys: number[] } | null>(null);
  const guidesKey = useRef("");
  const showGuides = (g: { xs: number[]; ys: number[] } | null) => {
    const key = g ? `${g.xs.join(",")}|${g.ys.join(",")}` : "";
    if (key === guidesKey.current) return;
    guidesKey.current = key;
    setGuides(g);
  };
  /**
   * Smart snapping: the box's edges and centre snap to the edges and centres of the other layers and of
   * the canvas (within 0.8 mm). Returns the correction and the guide lines to show.
   */
  const smartSnap = useCallback(
    (box: BBox, excludeLayers: Set<string>, tol = 0.8): { dx: number; dy: number; xs: number[]; ys: number[] } => {
      const cx: number[] = [2, layout.widthMm / 2, layout.widthMm - 2];
      const cy: number[] = [2, layout.heightMm / 2, layout.heightMm - 2];
      for (const l of graph.layers) {
        if (excludeLayers.has(l.id)) continue;
        const f = l.frame;
        cx.push(f.xMm, f.xMm + f.wMm / 2, f.xMm + f.wMm);
        cy.push(f.yMm, f.yMm + f.hMm / 2, f.yMm + f.hMm);
      }
      const bx = [box.x0, (box.x0 + box.x1) / 2, box.x1];
      const by = [box.y0, (box.y0 + box.y1) / 2, box.y1];
      let bestX: { d: number; line: number } | null = null;
      let bestY: { d: number; line: number } | null = null;
      for (const c of cx) for (const b of bx) if (Math.abs(c - b) < tol && (!bestX || Math.abs(c - b) < Math.abs(bestX.d))) bestX = { d: c - b, line: c };
      for (const c of cy) for (const b of by) if (Math.abs(c - b) < tol && (!bestY || Math.abs(c - b) < Math.abs(bestY.d))) bestY = { d: c - b, line: c };
      return { dx: bestX?.d ?? 0, dy: bestY?.d ?? 0, xs: bestX ? [bestX.line] : [], ys: bestY ? [bestY.line] : [] };
    },
    [graph.layers, layout.widthMm, layout.heightMm],
  );

  const applyDrag = useCallback(
    (e: { clientX: number; clientY: number; shiftKey: boolean }, final: boolean) => {
      const d = drag.current;
      if (!d) return;
      const [mx, my] = toMm(e);
      const dx = mx - d.startX;
      const dy = my - d.startY;
      const state = st.getState();
      const r = (v: number) => Math.round(v * 10) / 10;
      // A press that wobbles by a few screen pixels is a click, not a drag: nothing moves until the
      // pointer has travelled CLICK_PX, whatever the zoom.
      const moved = Math.hypot(dx, dy) * pxPerMmRef.current >= CLICK_PX;
      if (d.kind === "marquee") {
        const rect = { x0: Math.min(d.startX, mx), y0: Math.min(d.startY, my), x1: Math.max(d.startX, mx), y1: Math.max(d.startY, my) };
        if (!final) {
          setMarquee(rect);
          return;
        }
        setMarquee(null);
        drag.current = null;
        frozenSize.current = null;
        if (rect.x1 - rect.x0 < 0.5 && rect.y1 - rect.y0 < 0.5) {
          if (d.clickSel) select(d.clickSel); // ⌘-click without dragging: plain selection
          return;
        }
        // objects count when they overlap the box; layers when at least half of their frame is covered
        const overlap = (b: BBox) => Math.max(0, Math.min(b.x1, rect.x1) - Math.max(b.x0, rect.x0)) * Math.max(0, Math.min(b.y1, rect.y1) - Math.max(b.y0, rect.y0));
        const inside = (b: BBox) => overlap(b) > 0;
        const mostlyInside = (b: BBox) => overlap(b) >= 0.5 * (b.x1 - b.x0) * (b.y1 - b.y0);
        const found: Selection[] = [];
        for (const ll of layout.layers) {
          const lid = ll.layer.id;
          if (layerMode) {
            // L held: the lasso picks layers only (any overlap counts)
            const lb = bboxOf({ kind: "layer", graphId: graph.id, layerId: lid });
            if (lb && inside(lb)) found.push({ kind: "layer", graphId: graph.id, layerId: lid });
            continue;
          }
          for (const sh of ll.layer.shapes ?? []) {
            const it: Selection = { kind: "shape", graphId: graph.id, layerId: lid, shapeId: sh.id };
            const b = bboxOf(it);
            if (b && inside(b)) found.push(it);
          }
          for (const t of ll.layer.texts) {
            const it: Selection = { kind: "text", graphId: graph.id, layerId: lid, textId: t.id };
            const b = bboxOf(it);
            if (b && inside(b)) found.push(it);
          }
          if (ll.layer.legend.visible && ll.legend.entries.length) {
            const it: Selection = { kind: "legend", graphId: graph.id, layerId: lid };
            const b = bboxOf(it);
            if (b && inside(b)) found.push(it);
          }
          if (ll.colorScale) {
            const it: Selection = { kind: "colorScale", graphId: graph.id, layerId: lid };
            const b = bboxOf(it);
            if (b && inside(b)) found.push(it);
          }
          const lb = bboxOf({ kind: "layer", graphId: graph.id, layerId: lid });
          if (lb && mostlyInside(lb)) found.push({ kind: "layer", graphId: graph.id, layerId: lid });
        }
        if (found.length) {
          shiftSelecting.current = true;
          state.setSelection(found[0]);
          setMulti(found.slice(1));
        }
        return;
      }
      if (d.kind === "draw" && d.tool === "freehand") {
        // the pen: collect the trail, keep points at least 0.3 mm apart
        const trail = d.trail ?? [];
        const lastP = trail[trail.length - 1];
        if (!lastP || Math.hypot(mx - lastP.x, my - lastP.y) >= 0.3) trail.push({ x: mx, y: my });
        d.trail = trail;
        if (!final) {
          setDrawPreview({ tool: d.tool, x1: d.startX, y1: d.startY, x2: mx, y2: my, trail: [...trail] });
          return;
        }
        setDrawPreview(null);
        drag.current = null;
        frozenSize.current = null;
        if (trail.length >= 2) {
          const r1 = (v: number) => Math.round(v * 100) / 100;
          const pts = trail.map((p) => ({ x: r1(p.x), y: r1(p.y) }));
          const xs = pts.map((p) => p.x);
          const ys = pts.map((p) => p.y);
          const id = state.addShape(graph.id, d.layerId, "freehand", Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), { points: pts, smoothing: drawOptsRef.current.freehand });
          state.setSelection({ kind: "shape", graphId: graph.id, layerId: d.layerId, shapeId: id });
        }
        setDrawTool(null);
        return;
      }
      if (d.kind === "draw") {
        let x2 = mx;
        let y2 = my;
        if (e.shiftKey) {
          // constrain: 45° steps for lines, square for rect/ellipse
          const ddx = mx - d.startX;
          const ddy = my - d.startY;
          if (d.tool === "line" || d.tool === "arrow") {
            const ang = Math.round(Math.atan2(ddy, ddx) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(ddx, ddy);
            x2 = d.startX + Math.cos(ang) * len;
            y2 = d.startY + Math.sin(ang) * len;
          } else {
            const sz = Math.max(Math.abs(ddx), Math.abs(ddy));
            x2 = d.startX + Math.sign(ddx || 1) * sz;
            y2 = d.startY + Math.sign(ddy || 1) * sz;
          }
        }
        if (!final) {
          setDrawPreview({ tool: d.tool, x1: d.startX, y1: d.startY, x2, y2 });
          return;
        }
        setDrawPreview(null);
        drag.current = null;
        frozenSize.current = null;
        if (Math.hypot(x2 - d.startX, y2 - d.startY) >= 1) {
          const r1 = (v: number) => Math.round(v * 10) / 10;
          const corner = drawOptsRef.current.cornerMm;
          const id = state.addShape(graph.id, d.layerId, d.tool, r1(d.startX), r1(d.startY), r1(x2), r1(y2), d.tool === "rect" && corner > 0 ? { cornerRadiusMm: corner } : undefined);
          state.setSelection({ kind: "shape", graphId: graph.id, layerId: d.layerId, shapeId: id });
        }
        setDrawTool(null);
        return;
      }
      if (d.kind === "shape") {
        // move: preview with a transform, commit once at release
        let sdx = moved ? r(dx) : 0;
        let sdy = moved ? r(dy) : 0;
        if (moved && !e.shiftKey) {
          const b = { x0: Math.min(d.s.x1, d.s.x2) + sdx, y0: Math.min(d.s.y1, d.s.y2) + sdy, x1: Math.max(d.s.x1, d.s.x2) + sdx, y1: Math.max(d.s.y1, d.s.y2) + sdy };
          const sn = smartSnap(b, new Set());
          sdx = r(sdx + sn.dx);
          sdy = r(sdy + sn.dy);
          showGuides(final ? null : sn);
        } else showGuides(null);
        if (!final) {
          applyPreview(sdx, sdy);
          return;
        }
        clearPreview();
        drag.current = null;
        frozenSize.current = null;
        ctmRef.current = null;
        if (!moved) return;
        const s0 = d.s;
        flushSync(() => writeShape(d.layerId, d.shapeId, { x1: s0.x1 + sdx, y1: s0.y1 + sdy, x2: s0.x2 + sdx, y2: s0.y2 + sdy }));
        return;
      }
      if (d.kind === "shapeHandle" && d.pts) {
        // a vertex of a polyline / polygon / freehand shape
        if (!final && !moved) return;
        if (final) {
          writeShapePoints(d.layerId, d.shapeId, d.pts);
          resumeHistory();
          if (!moved) {
            drag.current = null;
            frozenSize.current = null;
            return;
          }
        }
        const pts = d.pts.map((p, i) => (i === d.handle ? { x: p.x + dx, y: p.y + dy } : p));
        writeShapePoints(d.layerId, d.shapeId, pts);
        if (final) {
          drag.current = null;
          frozenSize.current = null;
        }
        return;
      }
      if (d.kind === "shapeHandle") {
        const s0 = d.s;
        if (!final && !moved) return;
        if (final) {
          writeShape(d.layerId, d.shapeId, s0);
          resumeHistory();
          if (!moved) {
            drag.current = null;
            frozenSize.current = null;
            return;
          }
        }
        const n: ShapeMm = { ...s0 };
        if (d.shapeKind === "line" || d.shapeKind === "arrow") {
          if (d.handle === 0) {
            n.x1 = s0.x1 + dx;
            n.y1 = s0.y1 + dy;
          } else {
            n.x2 = s0.x2 + dx;
            n.y2 = s0.y2 + dy;
          }
        } else if (d.lockAspect && Math.abs(s0.x2 - s0.x1) > 0.01 && Math.abs(s0.y2 - s0.y1) > 0.01) {
          // scale about the opposite corner, keeping the proportions (the larger of the two pulls wins)
          const left = d.handle === 0 || d.handle === 2;
          const top = d.handle === 0 || d.handle === 1;
          const ax = left ? s0.x2 : s0.x1;
          const ay = top ? s0.y2 : s0.y1;
          const mx0 = left ? s0.x1 : s0.x2;
          const my0 = top ? s0.y1 : s0.y2;
          const w0 = mx0 - ax;
          const h0 = my0 - ay;
          const sc = Math.max(0.02, Math.max((mx0 + dx - ax) / w0, (my0 + dy - ay) / h0));
          if (left) n.x1 = ax + w0 * sc;
          else n.x2 = ax + w0 * sc;
          if (top) n.y1 = ay + h0 * sc;
          else n.y2 = ay + h0 * sc;
        } else {
          // corners: 0 = (x1,y1) 1 = (x2,y1) 2 = (x1,y2) 3 = (x2,y2)
          if (d.handle === 0 || d.handle === 2) n.x1 = s0.x1 + dx;
          else n.x2 = s0.x2 + dx;
          if (d.handle === 0 || d.handle === 1) n.y1 = s0.y1 + dy;
          else n.y2 = s0.y2 + dy;
        }
        writeShape(d.layerId, d.shapeId, n);
        if (final) {
          drag.current = null;
          frozenSize.current = null;
        }
        return;
      }
      if (d.kind === "cropHandle") {
        if (!final && !moved) return;
        const s0 = d.s;
        const c0 = d.crop;
        const writeCrop = (mm: ShapeMm, crop: typeof c0) =>
          st.getState().updateShape(graph.id, d.layerId, d.shapeId, (sh) => {
            const r1 = (v: number) => Math.round(v * 10) / 10;
            Object.assign(sh, { x1: r1(mm.x1), y1: r1(mm.y1), x2: r1(mm.x2), y2: r1(mm.y2), crop: { x: +crop.x.toFixed(4), y: +crop.y.toFixed(4), w: +crop.w.toFixed(4), h: +crop.h.toFixed(4) } });
          });
        if (final) {
          writeCrop(s0, c0);
          resumeHistory();
          if (!moved) {
            drag.current = null;
            frozenSize.current = null;
            return;
          }
        }
        // the full (uncropped) picture size in mm, from the visible part and its crop fractions
        const left = Math.min(s0.x1, s0.x2);
        const right = Math.max(s0.x1, s0.x2);
        const top = Math.min(s0.y1, s0.y2);
        const bottom = Math.max(s0.y1, s0.y2);
        const fullW = (right - left) / c0.w;
        const fullH = (bottom - top) / c0.h;
        const n = { x1: left, y1: top, x2: right, y2: bottom };
        const c = { ...c0 };
        const MIN = 0.02;
        if (d.side === "w") {
          const nx = Math.min(right - fullW * MIN, Math.max(left - c0.x * fullW, left + dx));
          c.x = c0.x + (nx - left) / fullW;
          c.w = c0.w - (nx - left) / fullW;
          n.x1 = nx;
        } else if (d.side === "e") {
          const nx = Math.max(left + fullW * MIN, Math.min(left + (1 - c0.x) * fullW, right + dx));
          c.w = (nx - left) / fullW;
          n.x2 = nx;
        } else if (d.side === "n") {
          const ny = Math.min(bottom - fullH * MIN, Math.max(top - c0.y * fullH, top + dy));
          c.y = c0.y + (ny - top) / fullH;
          c.h = c0.h - (ny - top) / fullH;
          n.y1 = ny;
        } else {
          const ny = Math.max(top + fullH * MIN, Math.min(top + (1 - c0.y) * fullH, bottom + dy));
          c.h = (ny - top) / fullH;
          n.y2 = ny;
        }
        writeCrop(n, c);
        if (final) {
          drag.current = null;
          frozenSize.current = null;
        }
        return;
      }
      if (d.kind === "group") {
        let gdx = moved ? r(dx) : 0;
        let gdy = moved ? r(dy) : 0;
        if (moved && d.box && !e.shiftKey) {
          const exclude = new Set(d.items.filter((i) => i.kind === "layer").map((i) => (i as { layerId: string }).layerId));
          const sn = smartSnap({ x0: d.box.x0 + gdx, y0: d.box.y0 + gdy, x1: d.box.x1 + gdx, y1: d.box.y1 + gdy }, exclude);
          gdx = r(gdx + sn.dx);
          gdy = r(gdy + sn.dy);
          showGuides(final ? null : sn);
        } else showGuides(null);
        if (!final) {
          applyPreview(gdx, gdy);
          return;
        }
        clearPreview();
        drag.current = null;
        frozenSize.current = null;
        ctmRef.current = null;
        // one store write = one undo step for the whole group
        if (moved) flushSync(() => placeObjects(d.items, d.snaps, gdx, gdy));
        return;
      }
      if (d.kind === "zoomRect") {
        if (!final) {
          setZoomRect({ x0: d.startX, y0: d.startY, x1: mx, y1: my });
          return;
        }
        setZoomRect(null);
        resumeHistory();
        drag.current = null;
        frozenSize.current = null;
        const ll = layout.layers.find((x) => x.layer.id === d.layerId);
        if (!ll || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) return;
        const xa = ll.x.scale.invert(Math.min(d.startX, mx));
        const xb = ll.x.scale.invert(Math.max(d.startX, mx));
        const ya = ll.y.scale.invert(Math.max(d.startY, my));
        const yb = ll.y.scale.invert(Math.min(d.startY, my));
        state.updateLayer(graph.id, d.layerId, (l) => {
          if (!l.axes.x.scale || !ll.x.scale.categories) {
            l.axes.x.auto = false;
            l.axes.x.from = Math.min(xa, xb);
            l.axes.x.to = Math.max(xa, xb);
          }
          if (!ll.y.scale.categories) {
            l.axes.y.auto = false;
            l.axes.y.from = Math.min(ya, yb);
            l.axes.y.to = Math.max(ya, yb);
          }
        });
        return;
      }
      if (d.kind === "rotate") {
        if (final) {
          state.updateLayer(graph.id, d.layerId, (l) => {
            if (l.view3d) {
              l.view3d.azimuth = d.az;
              l.view3d.elevation = d.el;
            }
          });
          resumeHistory();
        }
        const az = ((d.az + dx * 2 + 540) % 360) - 180; // drag right → box turns to the right
        const el = Math.max(-89, Math.min(89, d.el + dy * 2));
        state.updateLayer(graph.id, d.layerId, (l) => {
          if (l.view3d) {
            l.view3d.azimuth = Math.round(az);
            l.view3d.elevation = Math.round(el);
          }
        });
        if (final) {
          drag.current = null;
          frozenSize.current = null;
        }
        return;
      }
      if (d.kind === "resize") {
        if (!final && !moved) return;
        if (final) {
          // restore the pre-drag value with history paused, then record a single undoable change
          state.updateLayer(graph.id, d.layerId, (l) => void (l.frame = { ...d.frame }));
          resumeHistory();
          if (!moved) {
            drag.current = null;
            frozenSize.current = null;
            return;
          }
        }
        const f = { ...d.frame };
        const min = 8;
        if (d.corner.includes("e")) f.wMm = Math.max(min, r(d.frame.wMm + dx));
        if (d.corner.includes("s")) f.hMm = Math.max(min, r(d.frame.hMm + dy));
        if (d.corner.includes("w")) {
          const w = Math.max(min, r(d.frame.wMm - dx));
          f.xMm = r(d.frame.xMm + d.frame.wMm - w);
          f.wMm = w;
        }
        if (d.corner.includes("n")) {
          const h = Math.max(min, r(d.frame.hMm - dy));
          f.yMm = r(d.frame.yMm + d.frame.hMm - h);
          f.hMm = h;
        }
        if (e.shiftKey) {
          const sz = Math.max(f.wMm, f.hMm);
          f.wMm = sz;
          f.hMm = sz;
        }
        state.updateLayer(graph.id, d.layerId, (l) => void (l.frame = f));
        if (final) {
          drag.current = null;
          frozenSize.current = null;
          ctmRef.current = null;
        }
        return;
      }
      // move drags: layer, legend, colour scale, text — previewed with a transform, one store write at release
      let mdx = moved ? r(dx) : 0;
      let mdy = moved ? r(dy) : 0;
      let frame: Layer["frame"] | null = null;
      if (d.kind === "layer" && moved) {
        const f = { ...d.frame, xMm: r(d.frame.xMm + dx), yMm: r(d.frame.yMm + dy) };
        if (!e.shiftKey) {
          const sn = smartSnap({ x0: f.xMm, y0: f.yMm, x1: f.xMm + f.wMm, y1: f.yMm + f.hMm }, new Set([d.layerId]));
          f.xMm = r(f.xMm + sn.dx);
          f.yMm = r(f.yMm + sn.dy);
          showGuides(final ? null : sn);
        } else showGuides(null);
        f.xMm = Math.max(0, Math.min(f.xMm, layout.widthMm - f.wMm));
        f.yMm = Math.max(0, f.yMm);
        frame = f;
        mdx = r(f.xMm - d.frame.xMm);
        mdy = r(f.yMm - d.frame.yMm);
      } else if (moved && d.kind === "text" && !e.shiftKey) {
        const b = bboxOf({ kind: "text", graphId: graph.id, layerId: d.layerId, textId: d.textId });
        if (b) {
          const sn = smartSnap({ x0: b.x0 + mdx, y0: b.y0 + mdy, x1: b.x1 + mdx, y1: b.y1 + mdy }, new Set());
          mdx = r(mdx + sn.dx);
          mdy = r(mdy + sn.dy);
          showGuides(final ? null : sn);
        }
      } else showGuides(null);
      if (!final) {
        applyPreview(mdx, mdy);
        return;
      }
      showGuides(null);
      clearPreview();
      drag.current = null;
      frozenSize.current = null;
      ctmRef.current = null;
      if (!moved) {
        if (d.kind === "layer" && d.clickSelect) state.setSelection(d.clickSelect);
        return;
      }
      flushSync(() => {
        if (d.kind === "layer" && frame) {
          const f = frame;
          state.updateLayer(graph.id, d.layerId, (l) => void (l.frame = f));
        } else if (d.kind === "legend") {
          state.updateLayer(graph.id, d.layerId, (l) => {
            l.legend.xMm = r(d.x + mdx);
            l.legend.yMm = r(d.y + mdy);
          });
        } else if (d.kind === "colorScale") {
          state.updateLayer(graph.id, d.layerId, (l) => {
            if (l.colorScale) {
              l.colorScale.xMm = r(d.x + mdx);
              l.colorScale.yMm = r(d.y + mdy);
            }
          });
        } else if (d.kind === "text") {
          writeText(d.layerId, d.textId, d.x + mdx, d.y + mdy);
        }
      });
    },
    [graph.id, smartSnap, st, toMm, layout.widthMm, bboxOf, moveObjectTo, placeObjects, writeShape, writeText, select, layerMode],
  );

  // Move drags preview immediately (a transform write is cheap). Drags that write the store (resize,
  // handles, rotate) and state previews are coalesced to one update per animation frame.
  const applyDragRef = useRef(applyDrag);
  applyDragRef.current = applyDrag;
  const pendingMove = useRef<{ clientX: number; clientY: number; shiftKey: boolean } | null>(null);
  const rafId = useRef<number | null>(null);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (MOVE_KINDS.has(d.kind)) {
      applyDragRef.current(e, false);
      return;
    }
    pendingMove.current = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
    if (rafId.current === null)
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        const ev = pendingMove.current;
        pendingMove.current = null;
        if (ev && drag.current) applyDragRef.current(ev, false);
      });
  }, []);

  const onHover = useCallback(
    (e: React.PointerEvent) => {
      if (drag.current || rangePick) {
        setReader(null);
        return;
      }
      const [mx, my] = toMm(e);
      let best: { d: number; text: string; x: number; y: number } | null = null;
      for (const ll of layout.layers) {
        if (ll.is3d) continue;
        const f = ll.layer.frame;
        if (mx < f.xMm - 2 || mx > f.xMm + f.wMm + 2 || my < f.yMm - 2 || my > f.yMm + f.hMm + 2) continue;
        for (const p of ll.layer.plots) {
          if (!p.visible || !["scatter", "line", "lineScatter", "fitCurve"].includes(p.type)) continue;
          const d = ll.data.get(p.id);
          if (!d) continue;
          const ys = p.yAxis === "y2" && ll.y2 ? ll.y2.scale : ll.y.scale;
          for (let i = 0; i < d.x.length; i++) {
            const px = ll.x.scale.map(d.x[i]);
            const py = ys.map(d.y[i]);
            if (px === null || py === null) continue;
            const dist = Math.hypot(px - mx, py - my);
            if (dist < 2.5 && (!best || dist < best.d)) {
              const fmt = (v: number) => Number(v.toPrecision(6)).toString();
              best = { d: dist, text: `${p.name}: x = ${fmt(d.x[i])}, y = ${fmt(d.y[i])}${d.yErr ? ` ± ${fmt(d.yErr[i])}` : ""}`, x: px, y: py };
            }
          }
        }
      }
      setReader(best ? { xPx: best.x * pxPerMm, yPx: best.y * pxPerMm, text: best.text } : null);
    },
    [layout, pxPerMm, rangePick, toMm],
  );
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    pendingMove.current = null;
    if (drag.current) applyDragRef.current(e, true);
    ctmRef.current = null;
    showGuides(null);
  }, []);

  // inline editing ---------------------------------------------------------
  const openEditor = useCallback(
    (value: string, xMm: number, yMm: number, widthMm: number, sizePt: number, commit: (v: string) => void, rotate?: number) => {
      setEdit({ value, xPx: xMm * pxPerMm, yPx: yMm * pxPerMm, widthPx: Math.max(60, widthMm * pxPerMm), fontPx: ptToMm(sizePt) * pxPerMm, commit, rotate });
    },
    [pxPerMm],
  );

  const onDoubleClick = useCallback(
    (sel: Selection, _e: unknown, target?: "title" | "legendEntry" | "text", extra?: string) => {
      const state = st.getState();
      state.setInspectorCollapsed(false);
      const ll = "layerId" in sel ? layout.layers.find((x) => x.layer.id === sel.layerId) : undefined;
      if (!ll) return;
      const f = ll.layer.frame;
      if (sel.kind === "axis" && target === "title") {
        const ag = sel.axis === "x" ? ll.x : sel.axis === "y" ? ll.y : ll.y2;
        if (!ag) return;
        const axis = ag.axis;
        const w = Math.max(f.wMm, f.hMm);
        if (sel.axis === "x") openEditor(axis.title, f.xMm + f.wMm / 2 - w / 2, ag.titlePos, w, axis.titleStyle.sizePt, (v) => state.updateAxis(graph.id, ll.layer.id, sel.axis, (a) => void (a.title = v)));
        else
          openEditor(axis.title, ag.side < 0 ? ag.titlePos - ag.titleExtent : ag.titlePos, f.yMm + f.hMm / 2 + w / 2, w, axis.titleStyle.sizePt, (v) => state.updateAxis(graph.id, ll.layer.id, sel.axis, (a) => void (a.title = v)), -90);
      } else if (sel.kind === "legend" && target === "legendEntry" && extra) {
        const entry = ll.legend.entries.find((e) => e.plot.id === extra);
        if (!entry) return;
        const lg = ll.legend;
        openEditor(entry.plot.name, lg.x + lg.pad + entry.x + ll.layer.legend.symbolWidthMm + 1.2, lg.y + entry.y, Math.max(20, lg.w), ll.layer.legend.style.sizePt, (v) =>
          state.updatePlot(graph.id, ll.layer.id, extra, (p) => void (p.name = v)),
        );
      } else if (sel.kind === "text") {
        const t = ll.layer.texts.find((x) => x.id === sel.textId);
        const pos = ll.textMm.get(sel.textId);
        if (!t || !pos) return;
        openEditor(t.text, t.anchor === "start" ? pos.x : pos.x - 15, pos.y - ptToMm(t.style.sizePt) * 0.9, 30, t.style.sizePt, (v) =>
          state.updateLayer(graph.id, ll.layer.id, (l) => {
            const tt = l.texts.find((x) => x.id === sel.textId);
            if (tt) tt.text = v;
          }),
        );
      }
    },
    [graph.id, layout.layers, openEditor, st],
  );

  // Stable handler identities so memoised SVG layers are not re-rendered by handler churn.
  const handlersRef = useRef({ onPointerDown, onDoubleClick });
  handlersRef.current = { onPointerDown, onDoubleClick };
  const stablePointerDown = useCallback<InteractiveProps["onPointerDown"]>((sel, e) => handlersRef.current.onPointerDown(sel, e), []);
  const stableDoubleClick = useCallback<InteractiveProps["onDoubleClick"]>((sel, e, target, extra) => handlersRef.current.onDoubleClick(sel, e, target, extra), []);
  const interactive = useMemo<InteractiveProps>(
    () => ({ selection, selections: multi, layerMode, onPointerDown: stablePointerDown, onDoubleClick: stableDoubleClick }),
    [selection, multi, layerMode, stablePointerDown, stableDoubleClick],
  );

  // keyboard -----------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const state = st.getState();
      if (state.ui.activeTab?.kind !== "graph" || state.ui.activeTab.id !== graph.id) return;
      const sel = state.ui.selection;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setZoom((zoom || 1) * 1.25);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        setZoom((zoom || 1) / 1.25);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        zoomFit();
      } else if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
      } else if (mod && e.key.toLowerCase() === "c" && (sel.kind === "shape" || sel.kind === "text" || sel.kind === "layer" || multi.length)) {
        e.preventDefault();
        copySelection();
      } else if (mod && e.key.toLowerCase() === "v" && (state.ui.objectClipboard?.length || state.ui.layerClipboard?.length)) {
        // do not preventDefault: a picture in the system clipboard arrives through the paste event first
        pasteAll();
      } else if (mod && e.key.toLowerCase() === "d" && (sel.kind === "shape" || sel.kind === "text" || sel.kind === "layer" || multi.length)) {
        e.preventDefault();
        copySelection();
        pasteAll();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === "Enter" && polyDraft) {
        e.preventDefault();
        finishPoly(true);
      } else if (e.key === "Escape") {
        if (polyDraft) finishPoly(false);
        else if (drawTool) setDrawTool(null);
        else state.setSelection({ kind: "canvas", graphId: graph.id });
        setMulti([]);
      } else if (e.key.startsWith("Arrow") && "layerId" in sel) {
        e.preventDefault();
        const step = e.shiftKey ? 2 : 0.5;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (multi.length) {
          // nudge the whole selection in one store write (one undo step)
          const items = [sel, ...multi];
          const snaps = new Map<string, ObjectSnap>();
          for (const it of items) {
            const sn = snapshotObject(it);
            if (sn) snaps.set(JSON.stringify(it), sn);
          }
          placeObjects(items, snaps, dx, dy);
          return;
        }
        if (sel.kind === "shape" || sel.kind === "text") {
          const b = bboxOf(sel);
          if (b) moveObjectTo(sel, b.x0 + dx, b.y0 + dy);
          return;
        }
        state.updateLayer(graph.id, sel.layerId, (l) => {
          if (sel.kind === "layer") {
            l.frame.xMm += dx;
            l.frame.yMm += dy;
          } else if (sel.kind === "legend") {
            l.legend.xMm += dx;
            l.legend.yMm += dy;
          } else if (sel.kind === "colorScale" && l.colorScale) {
            l.colorScale.xMm += dx;
            l.colorScale.yMm += dy;
          }
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const onZoom = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (st.getState().ui.activeTab?.id !== graph.id) return;
      if (id === "zoomIn") setZoom((zoom || 1) * 1.25);
      else if (id === "zoomOut") setZoom((zoom || 1) / 1.25);
      else zoomFit();
    };
    const onAddText = () => {
      if (st.getState().ui.activeTab?.id === graph.id) addText();
    };
    const onDraw = (e: Event) => {
      if (st.getState().ui.activeTab?.id === graph.id) setDrawTool((e as CustomEvent<ShapeKind>).detail);
    };
    window.addEventListener("plotkit:zoom", onZoom);
    window.addEventListener("plotkit:addText", onAddText);
    window.addEventListener("plotkit:draw", onDraw);
    // a picture pasted from the clipboard lands on the selected layer
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const state = st.getState();
      if (state.ui.activeTab?.kind !== "graph" || state.ui.activeTab.id !== graph.id) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      const sel = state.ui.selection;
      for (const f of files) void fileToDataUrl(f).then((url) => insertImageIntoGraph(graph.id, url, { layerId: "layerId" in sel ? sel.layerId : undefined, name: f.name || "Pasted image" }));
    };
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("plotkit:zoom", onZoom);
      window.removeEventListener("plotkit:addText", onAddText);
      window.removeEventListener("plotkit:draw", onDraw);
      window.removeEventListener("paste", onPaste);
    };
  });

  /**
   * Copy the whole selection: layers go to the layer clipboard (keeping their relative positions), shapes
   * and texts to the object clipboard. Objects attached to the axes of a copied layer travel with it.
   */
  const copySelection = () => {
    const state = st.getState();
    const all = [state.ui.selection, ...multi];
    const layerIds = new Set(all.filter((x) => x.kind === "layer").map((x) => (x as { layerId: string }).layerId));
    const layers = graph.layers.filter((l) => layerIds.has(l.id));
    const items: NonNullable<typeof state.ui.objectClipboard> = [];
    for (const it of all) {
      if (!("layerId" in it)) continue;
      const l = layerById(it.layerId);
      if (!l) continue;
      if (layerIds.has(l.id)) continue; // the layer copy already carries its own shapes and texts
      if (it.kind === "shape") {
        const sh = l.shapes?.find((x) => x.id === it.shapeId);
        if (sh) items.push({ kind: "shape", shape: sh });
      } else if (it.kind === "text") {
        const t = l.texts.find((x) => x.id === it.textId);
        if (t) items.push({ kind: "text", text: t });
      }
    }
    if (!layers.length && !items.length) return;
    state.setLayerClipboard(layers.length ? layers : null);
    state.setObjectClipboard(items.length ? items : null);
    const parts = [layers.length ? `${layers.length} layer${layers.length > 1 ? "s" : ""}` : "", items.length ? `${items.length} object${items.length > 1 ? "s" : ""}` : ""].filter(Boolean);
    useDialogs.getState().showToast(`${parts.join(" and ")} copied`);
  };

  /** Paste the layer clipboard (as a group, one undo step) and the object clipboard, and select everything pasted. */
  const pasteAll = () => {
    const state = st.getState();
    const layers = state.ui.layerClipboard ?? [];
    const copies = prepareLayerCopies(layers);
    const pasted: Selection[] = copies.map((l) => ({ kind: "layer", graphId: graph.id, layerId: l.id }));
    const objects = prepareObjectCopies(copies[0]?.id);
    pasted.push(...objects.selections);
    if (!pasted.length) return;
    state.addGraphItems(graph.id, copies, objects.shapes, objects.texts);
    shiftSelecting.current = true;
    st.getState().setSelection(pasted[0]);
    setMulti(pasted.slice(1));
  };

  /** Clones of clipboard layers with fresh ids, offset by 5 mm, named uniquely (relative positions kept). */
  const prepareLayerCopies = (layers: Layer[]): Layer[] => {
    const names = graph.layers.map((x) => x.name);
    return layers.map((layer) => {
      const l: Layer = JSON.parse(JSON.stringify(layer));
      l.id = uid();
      l.plots.forEach((pl) => (pl.id = uid()));
      l.shapes?.forEach((sh) => (sh.id = uid()));
      l.texts.forEach((t) => (t.id = uid()));
      l.frame = { ...l.frame, xMm: l.frame.xMm + 5, yMm: l.frame.yMm + 5 };
      l.name = uniqueName(l.name, names);
      names.push(l.name);
      return l;
    });
  };

  /** ⌘A: every layer plus every free-standing shape and text (objects attached to axes follow their layer). */
  const selectAll = () => {
    const found: Selection[] = [];
    for (const l of graph.layers) found.push({ kind: "layer", graphId: graph.id, layerId: l.id });
    for (const l of graph.layers) {
      for (const sh of l.shapes ?? []) if (sh.coord !== "data") found.push({ kind: "shape", graphId: graph.id, layerId: l.id, shapeId: sh.id });
      for (const t of l.texts) if (t.coord !== "data") found.push({ kind: "text", graphId: graph.id, layerId: l.id, textId: t.id });
    }
    if (!found.length) return;
    shiftSelecting.current = true;
    st.getState().setSelection(found[0]);
    setMulti(found.slice(1));
  };

  /**
   * Copies of the clipboard objects for a target layer (the selected one by default), offset by 3 mm, with
   * fresh ids. Objects attached to the axes keep that attachment on the target layer's axes.
   */
  const prepareObjectCopies = (targetLayerId?: string): { shapes: { layerId: string; shape: Shape }[]; texts: { layerId: string; text: TextItem }[]; selections: Selection[] } => {
    const none = { shapes: [], texts: [], selections: [] };
    const state = st.getState();
    const items = state.ui.objectClipboard;
    if (!items?.length) return none;
    const sel = state.ui.selection;
    const layerId = targetLayerId ?? ("layerId" in sel ? sel.layerId : undefined) ?? graph.layers[0]?.id;
    const ll = layout.layers.find((x) => x.layer.id === layerId);
    if (!layerId || !ll) {
      // pasting into a layer that is only being created now: objects land in mm coordinates
      if (!layerId) return none;
    }
    const off = 3;
    const shapes: { layerId: string; shape: Shape }[] = [];
    const texts: { layerId: string; text: TextItem }[] = [];
    const selections: Selection[] = [];
    for (const it of items) {
      if (it.kind === "shape") {
        const src = it.shape;
        // work in mm so the offset is visible regardless of the coordinate mode
        const a0 = src.coord === "data" && ll ? ll.toMm(src.x1, src.y1) : { x: src.x1, y: src.y1 };
        const b0 = src.coord === "data" && ll ? ll.toMm(src.x2, src.y2) : { x: src.x2, y: src.y2 };
        const shape: Shape = { ...JSON.parse(JSON.stringify(src)), id: uid(), x1: a0.x + off, y1: a0.y + off, x2: b0.x + off, y2: b0.y + off, coord: "mm" };
        if (src.points) {
          const ptsMm = src.points.map((p) => (src.coord === "data" && ll ? ll.toMm(p.x, p.y) : p)).map((p) => ({ x: p.x + off, y: p.y + off }));
          if (src.coord === "data" && ll) shape.coord = "data";
          setPoints(shape, ptsMm, ll ?? undefined);
          shapes.push({ layerId, shape });
          selections.push({ kind: "shape", graphId: graph.id, layerId, shapeId: shape.id });
          continue;
        }
        if (src.coord === "data" && ll) {
          const a = ll.toData(a0.x + off, a0.y + off);
          const b = ll.toData(b0.x + off, b0.y + off);
          Object.assign(shape, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, coord: "data" });
        }
        shapes.push({ layerId, shape });
        selections.push({ kind: "shape", graphId: graph.id, layerId, shapeId: shape.id });
      } else {
        const src = it.text;
        const pos = src.coord === "data" && ll ? ll.toMm(src.xMm, src.yMm) : { x: src.xMm, y: src.yMm };
        const text: TextItem = { ...src, id: uid(), style: { ...src.style }, xMm: pos.x + off, yMm: pos.y + off, coord: "mm" };
        if (src.coord === "data" && ll) {
          const d = ll.toData(pos.x + off, pos.y + off);
          text.xMm = d.x;
          text.yMm = d.y;
          text.coord = "data";
        }
        texts.push({ layerId, text });
        selections.push({ kind: "text", graphId: graph.id, layerId, textId: text.id });
      }
    }
    return { shapes, texts, selections };
  };

  // ⌘/Ctrl + scroll wheel zooms the canvas
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const z = st.getState().ui.zoom[graph.id] || 1;
      setZoom(z * Math.exp(-e.deltaY * 0.002)); // one mouse notch ≈ ×1.2, trackpad steps are finer
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [graph.id, setZoom, st]);

  const deleteSelection = () => {
    const state = st.getState();
    const sel = state.ui.selection;
    if (sel.kind === "plot") state.deletePlot(graph.id, sel.layerId, sel.plotId);
    else if (sel.kind === "text") state.updateLayer(graph.id, sel.layerId, (l) => void (l.texts = l.texts.filter((t) => t.id !== sel.textId)));
    else if (sel.kind === "shape" || multi.length) {
      const all = [sel, ...multi];
      const layerIds = all.filter((x) => x.kind === "layer").map((x) => (x as { layerId: string }).layerId);
      const run = () => {
        const s2 = st.getState();
        for (const it of all) {
          if (it.kind === "shape") s2.deleteShape(graph.id, it.layerId, it.shapeId);
          else if (it.kind === "text") s2.updateLayer(graph.id, it.layerId, (l) => void (l.texts = l.texts.filter((t) => t.id !== it.textId)));
          else if (it.kind === "legend") s2.updateLayer(graph.id, it.layerId, (l) => void (l.legend.visible = false));
        }
        // keep at least one layer in the graph
        const keep = layerIds.length >= graph.layers.length ? layerIds.slice(1) : layerIds;
        if (keep.length) s2.deleteLayers(graph.id, keep);
        setMulti([]);
        s2.setSelection({ kind: "canvas", graphId: graph.id });
      };
      if (layerIds.length) {
        void confirmDialog(`Delete ${layerIds.length} layer${layerIds.length > 1 ? "s" : ""} with their plots, plus the other selected objects?`).then((ok) => ok && run());
        return;
      }
      run();
      return;
    }
    else if (sel.kind === "legend") state.updateLayer(graph.id, sel.layerId, (l) => void (l.legend.visible = false));
    else if (sel.kind === "layer") {
      if (graph.layers.length > 1) {
        const layerId = sel.layerId;
        void confirmDialog("Delete this layer and its plots?").then((ok) => {
          if (!ok) return;
          st.getState().deleteLayer(graph.id, layerId);
          st.getState().setSelection({ kind: "canvas", graphId: graph.id });
        });
      }
      return;
    } else return;
    state.setSelection({ kind: "canvas", graphId: graph.id });
  };

  const addText = () => {
    const state = st.getState();
    const sel = state.ui.selection;
    const layer = ("layerId" in sel ? layerById(sel.layerId) : undefined) ?? graph.layers[0];
    if (!layer) return;
    const t: TextItem = {
      id: uid(),
      text: "Text",
      xMm: layer.frame.xMm + layer.frame.wMm / 2,
      yMm: layer.frame.yMm + layer.frame.hMm / 2,
      style: { ...st.getState().project.defaults.legend, sizePt: 9 },
      rotation: 0,
      anchor: "middle",
    };
    state.updateLayer(graph.id, layer.id, (l) => void l.texts.push(t));
    state.setSelection({ kind: "text", graphId: graph.id, layerId: layer.id, textId: t.id });
    openEditor(t.text, t.xMm - 15, t.yMm - ptToMm(9) * 0.9, 30, 9, (v) =>
      state.updateLayer(graph.id, layer.id, (l) => {
        const tt = l.texts.find((x) => x.id === t.id);
        if (tt) tt.text = v;
      }),
    );
  };

  const contextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const state = st.getState();
    const sel = state.ui.selection;
    const items: MenuItem[] = [];
    if (sel.kind === "layer") {
      items.push(
        { label: multi.length ? "Duplicate selection" : "Duplicate layer", shortcut: "⌘D", onSelect: () => { copySelection(); pasteAll(); } },
        { label: multi.length ? "Copy selection" : "Copy layer", shortcut: "⌘C", onSelect: copySelection },
        { label: "Paste", shortcut: "⌘V", disabled: !state.ui.layerClipboard?.length && !state.ui.objectClipboard?.length, onSelect: pasteAll },
        { label: "Select all", shortcut: "⌘A", onSelect: selectAll },
        { label: "Group selection", shortcut: "⌘G", disabled: multi.length < 1, onSelect: groupSelection },
        { label: "Ungroup", shortcut: "⇧⌘G", disabled: !groupMembersOf(sel), onSelect: ungroupSelection },
        { type: "sep" },
        { label: "Fit a curve…", onSelect: () => useDialogs.getState().setFitDialog({ graphId: graph.id, layerId: sel.layerId, plotId: null }) },
        { label: "Add text", onSelect: addText },
        { type: "sep" },
        { label: "Delete layer", disabled: graph.layers.length < 2, onSelect: deleteSelection },
      );
    } else if (sel.kind === "plot") {
      const plot = graph.layers.find((l) => l.id === sel.layerId)?.plots.find((p) => p.id === sel.plotId);
      const src = plot && !plot.func ? plotColumnIds(state.project, plot) : null;
      const pasteTargets = [sel, ...multi.filter((m): m is Extract<Selection, { kind: "plot" }> => m.kind === "plot")];
      items.push(
        { label: "Go to data sheet", disabled: !src, onSelect: () => src && goToDataSheet(src.sheetId, src.colIds) },
        { label: "Fit a curve…", onSelect: () => useDialogs.getState().setFitDialog({ graphId: graph.id, layerId: sel.layerId, plotId: sel.plotId }) },
        { type: "sep" },
        { label: "Copy style", disabled: !plot, onSelect: () => plot && copyPlotStyle(plot, true) },
        {
          label: pasteTargets.length > 1 ? `Paste style on ${pasteTargets.length} plots` : "Paste style",
          disabled: !pastedPlotStyle(),
          onSelect: () =>
            state.updateGraph(graph.id, (g) => {
              const st = pastedPlotStyle();
              if (!st) return;
              for (const t of pasteTargets) {
                const pl = g.layers.find((l) => l.id === t.layerId)?.plots.find((x) => x.id === t.plotId);
                if (pl) applyPlotStyle(pl, st);
              }
            }),
        },
        { type: "sep" },
        { label: "Bring forward", onSelect: () => state.movePlot(graph.id, sel.layerId, sel.plotId, 1) },
        { label: "Send backward", onSelect: () => state.movePlot(graph.id, sel.layerId, sel.plotId, -1) },
        { label: "Bring to front", onSelect: () => state.movePlot(graph.id, sel.layerId, sel.plotId, "front") },
        { label: "Send to back", onSelect: () => state.movePlot(graph.id, sel.layerId, sel.plotId, "back") },
        { type: "sep" },
        { label: "Remove plot", onSelect: deleteSelection },
      );
    } else if (sel.kind === "text") {
      items.push(
        { label: "Copy", shortcut: "⌘C", onSelect: copySelection },
        { label: "Duplicate", shortcut: "⌘D", onSelect: () => { copySelection(); pasteAll(); } },
        { label: "Group selection", shortcut: "⌘G", disabled: multi.length < 1, onSelect: groupSelection },
        { label: "Ungroup", shortcut: "⇧⌘G", disabled: !groupMembersOf(sel), onSelect: ungroupSelection },
        { type: "sep" },
        { label: "Delete text", onSelect: deleteSelection },
      );
    } else if (sel.kind === "shape") {
      const shp = layerById(sel.layerId)?.shapes?.find((x) => x.id === sel.shapeId);
      items.push(
        { label: "Copy", shortcut: "⌘C", onSelect: copySelection },
        { label: "Duplicate", shortcut: "⌘D", onSelect: () => { copySelection(); pasteAll(); } },
        { label: "Group selection", shortcut: "⌘G", disabled: multi.length < 1, onSelect: groupSelection },
        { label: "Ungroup", shortcut: "⇧⌘G", disabled: !groupMembersOf(sel), onSelect: ungroupSelection },
        { type: "sep" },
        { label: "Bring forward", onSelect: () => state.moveShape(graph.id, sel.layerId, sel.shapeId, 1) },
        { label: "Send backward", onSelect: () => state.moveShape(graph.id, sel.layerId, sel.shapeId, -1) },
        { label: "Bring to front", onSelect: () => state.moveShape(graph.id, sel.layerId, sel.shapeId, "front") },
        { label: "Send to back", onSelect: () => state.moveShape(graph.id, sel.layerId, sel.shapeId, "back") },
        { label: "Behind the data", checked: !!shp?.behindData, onSelect: () => state.updateShape(graph.id, sel.layerId, sel.shapeId, (s) => void (s.behindData = !s.behindData)) },
        { type: "sep" },
        { label: shp?.kind === "image" ? "Delete image" : "Delete shape", onSelect: deleteSelection },
      );
    } else if (sel.kind === "legend") {
      items.push({ label: "Hide legend", onSelect: deleteSelection });
    } else {
      items.push(
        { label: "Add layer", onSelect: () => state.setSelection({ kind: "layer", graphId: graph.id, layerId: state.addLayer(graph.id) }) },
        { label: "Paste", shortcut: "⌘V", disabled: !state.ui.layerClipboard?.length && !state.ui.objectClipboard?.length, onSelect: pasteAll },
        { label: "Select all", shortcut: "⌘A", onSelect: selectAll },
        { label: "Group selection", shortcut: "⌘G", disabled: multi.length < 1, onSelect: groupSelection },
        { label: "Ungroup", shortcut: "⇧⌘G", disabled: !groupMembersOf(sel), onSelect: ungroupSelection },
        { label: "Add text", onSelect: addText },
      );
    }
    items.push({ type: "sep" }, { label: "Export graph…", shortcut: "⇧⌘E", onSelect: () => useDialogs.getState().setExportDialog({ graphId: graph.id }) }, { label: "Copy as SVG", onSelect: () => void exportGraphAs(graph.id, "clipboard-svg") }, { label: "Copy as PNG", onSelect: () => void exportGraphAs(graph.id, "clipboard-png") });
    openMenu(e, items);
  };

  const selLayer = "layerId" in selection && selection.kind === "layer" ? layerById(selection.layerId) : undefined;
  const selShape = selection.kind === "shape" ? (() => {
    const shp = layerById(selection.layerId)?.shapes?.find((x) => x.id === selection.shapeId);
    const mm = shapeMmOf(selection.layerId, selection.shapeId);
    const pointsMm = layout.layers.find((x) => x.layer.id === selection.layerId)?.shapePointsMm.get(selection.shapeId);
    return shp && mm ? { ...shp, ...mm, layerId: selection.layerId, pointsMm } : undefined;
  })() : undefined;
  const shapeHandles = (shp: Shape & { pointsMm?: { x: number; y: number }[] }): [number, number][] =>
    shp.pointsMm
      ? shp.pointsMm.map((p): [number, number] => [p.x, p.y])
      : shp.kind === "line" || shp.kind === "arrow"
      ? [
          [shp.x1, shp.y1],
          [shp.x2, shp.y2],
        ]
      : [
          [shp.x1, shp.y1],
          [shp.x2, shp.y1],
          [shp.x1, shp.y2],
          [shp.x2, shp.y2],
        ];
  const picking = rangePick && rangePick.graphId === graph.id ? rangePick : null;
  const pickLayout = picking ? layout.layers.find((l) => l.layer.id === picking.layerId) : undefined;
  const pickPointer = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!picking) return;
      const [mx] = toMm(e);
      setPickDrag({ x0: mx, x1: mx });
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!picking || !pickDrag) return;
      const [mx] = toMm(e);
      setPickDrag({ x0: pickDrag.x0, x1: mx });
    },
    onPointerUp: () => {
      if (!picking || !pickDrag || !pickLayout) return;
      const a = pickLayout.x.scale.invert(Math.min(pickDrag.x0, pickDrag.x1));
      const b = pickLayout.x.scale.invert(Math.max(pickDrag.x0, pickDrag.x1));
      setPickDrag(null);
      picking.onPick(Math.min(a, b), Math.max(a, b));
    },
  };
  const sizeMm = frozenSize.current ?? { w: layout.widthMm, h: layout.heightMm };
  const widthPx = sizeMm.w * pxPerMm;
  const heightPx = sizeMm.h * pxPerMm;
  const handle = 6 / pxPerMm; // handle size in mm so it stays 6px on screen

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <button className="icon-btn" title="Zoom out (⌘-)" onClick={() => setZoom((zoom || 1) / 1.25)}>
          <Icon name="zoomOut" />
        </button>
        <span className="zoom-label" onClick={zoomFit} title="Fit (⌘0)">
          {Math.round((zoom || 1) * 100)}%
        </span>
        <button className="icon-btn" title="Zoom in (⌘+)" onClick={() => setZoom((zoom || 1) * 1.25)}>
          <Icon name="zoomIn" />
        </button>
        <button className="icon-btn" title="Fit to window (⌘0)" onClick={zoomFit}>
          <Icon name="zoomFit" />
        </button>
        <div className="toolbar-sep" />
        <button className="btn small" title="Add a text label" onClick={addText}>
          <Icon name="text" size={13} /> Add text
        </button>
        <button
          className="btn small"
          title="Plot a function y = f(x)"
          onClick={() => {
            const sel = st.getState().ui.selection;
            useDialogs.getState().setFunctionDialog({ graphId: graph.id, layerId: ("layerId" in sel ? sel.layerId : undefined) ?? graph.layers[0]?.id ?? "new" });
          }}
        >
          <Icon name="functionF" size={13} /> Function
        </button>
        <button
          className={"btn small" + (drawTool ? " primary" : "")}
          title="Draw a line, arrow, rectangle or ellipse (drag on the canvas; Esc cancels)"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openMenu({ clientX: r.left, clientY: r.bottom + 2 }, [
              { label: "Line", onSelect: () => setDrawTool("line") },
              { label: "Arrow", onSelect: () => setDrawTool("arrow") },
              { label: "Rectangle", onSelect: () => setDrawTool("rect") },
              { label: "Ellipse", onSelect: () => setDrawTool("ellipse") },
              { type: "sep" },
              { label: "Free-form (pen)", onSelect: () => setDrawTool("freehand") },
              { label: "Polyline (click points, double-click to finish)", onSelect: () => setDrawTool("polyline") },
              { label: "Polygon (click points, double-click to close)", onSelect: () => setDrawTool("polygon") },
              ...(drawTool ? [{ type: "sep" } as MenuItem, { label: "Stop drawing", onSelect: () => setDrawTool(null) }] : []),
            ]);
          }}
        >
          <Icon name="shapes" size={13} /> {drawTool ? `Drawing ${drawTool === "rect" ? "rectangle" : drawTool === "freehand" ? "free-form" : drawTool}…` : "Draw"}
        </button>
        {drawTool === "rect" && (
          <>
            <span className="hint">Corners</span>
            <input className="input" type="number" min={0} step={0.5} value={drawOpts.cornerMm} onChange={(e) => setDrawOpts({ ...drawOpts, cornerMm: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 48 }} title="Corner radius of the new rectangle (mm); 0 = square corners" />
            <span className="hint">mm</span>
          </>
        )}
        {(drawTool === "polyline" || drawTool === "polygon" || drawTool === "freehand") && (
          <>
            <span className="hint">Smoothing</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round((drawTool === "freehand" ? drawOpts.freehand : drawOpts.smoothing) * 100)}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                setDrawOpts(drawTool === "freehand" ? { ...drawOpts, freehand: v } : { ...drawOpts, smoothing: v });
              }}
              style={{ width: 80 }}
              title="How much the new curve is smoothed: 0 % = straight segments between the points, 100 % = a spline through them"
            />
            <span className="hint" style={{ minWidth: 34 }}>{Math.round((drawTool === "freehand" ? drawOpts.freehand : drawOpts.smoothing) * 100)} %</span>
          </>
        )}
        <button
          className="btn small"
          title="Fit a curve to the selected plot (⌘F)"
          onClick={() => {
            const sel = st.getState().ui.selection;
            const layerId = ("layerId" in sel ? sel.layerId : undefined) ?? graph.layers[0]?.id;
            if (layerId) useDialogs.getState().setFitDialog({ graphId: graph.id, layerId, plotId: sel.kind === "plot" ? sel.plotId : null });
          }}
        >
          <Icon name="fit" size={13} /> Fit
        </button>
        <button
          className="btn small"
          title="Import data (CSV, TSV, Excel) into a new sheet, or a picture (PNG, JPEG, SVG…) onto this graph. Pictures can also be pasted with ⌘V or dropped on the graph."
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openMenu({ clientX: r.left, clientY: r.bottom + 2 }, [
              { label: "Data (CSV, TSV, Excel)…", shortcut: "⌘I", onSelect: () => void importViaDialog() },
              { label: "Image…", onSelect: () => void importImageHere() },
            ]);
          }}
        >
          <Icon name="import" size={13} /> Import
        </button>
        {multi.length > 0 && (
          <>
            <div className="toolbar-sep" />
            <span className="hint">{multi.length + 1} selected</span>
            {(
              [
                ["alignLeft", "Align left edges", "left"],
                ["alignCenterH", "Align horizontal centers", "hcenter"],
                ["alignRight", "Align right edges", "right"],
                ["alignTop", "Align top edges", "top"],
                ["alignCenterV", "Align vertical centers", "vcenter"],
                ["alignBottom", "Align bottom edges", "bottom"],
              ] as const
            ).map(([icon, title, op]) => (
              <button key={op} className="icon-btn" title={title} onClick={() => alignSelected(op)}>
                <Icon name={icon} size={15} />
              </button>
            ))}
            <button className="icon-btn" title="Distribute horizontally (equal gaps)" disabled={multi.length < 2} onClick={() => alignSelected("distributeH")}>
              <Icon name="distributeH" size={15} />
            </button>
            <button className="icon-btn" title="Distribute vertically (equal gaps)" disabled={multi.length < 2} onClick={() => alignSelected("distributeV")}>
              <Icon name="distributeV" size={15} />
            </button>
            <button className="btn small" title="Give all selected layers the width and height of the first one" onClick={() => alignSelected("sameSize")}>
              Same size
            </button>
            <div className="toolbar-sep" />
            <input className="input" type="number" min={1} max={12} step={1} value={gridCols} onChange={(e) => setGridCols(Number(e.target.value) || 1)} style={{ width: 44 }} title="Columns of the grid" />
            <span className="hint">×</span>
            <input className="input" type="number" min={0} step={1} value={gridGap} onChange={(e) => setGridGap(Number(e.target.value) || 0)} style={{ width: 44 }} title="Gap between cells (mm)" />
            <button className="btn small" title="Arrange the selection on a grid with this many columns and gap, starting at the selection's top-left corner" disabled={multi.length < 1} onClick={arrangeGrid}>
              Grid
            </button>
            <div className="toolbar-sep" />
            <button className="btn small" title="Group the selected objects: they select and move as one (⌘G)" onClick={groupSelection}>
              Group
            </button>
            {groupMembersOf(selection) && (
              <button className="btn small" title="Dissolve the group (⇧⌘G)" onClick={ungroupSelection}>
                Ungroup
              </button>
            )}
          </>
        )}
        <div className="spacer" />
        <span className="hint status" title="Hold L to highlight the layers and pick a layer through anything drawn on top of it">
          {layerMode ? "Layer mode: click layers to select them (clicks add up), drag a selected layer to move them all, Shift+click removes one" : `Canvas ${layout.widthMm} × ${layout.heightMm} mm${selLayer ? ` · ${selLayer.name}: ${selLayer.frame.wMm} × ${selLayer.frame.hMm} mm` : ""}`}
        </span>
      </div>
      <Group orientation="vertical" style={{ flex: 1, minHeight: 0 }}>
      <Panel minSize={120}>
      <div
        ref={scrollRef}
        className="graph-scroll"
        style={{ height: "100%" }}
        onPointerMove={onHover}
        onPointerLeave={() => setReader(null)}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("graph-paper-wrap")) {
            st.getState().setSelection({ kind: "canvas", graphId: graph.id });
            closeEditor();
          }
        }}
        onContextMenu={contextMenu}
      >
        <div className="graph-paper-wrap" style={{ minWidth: widthPx + 48, minHeight: heightPx + 48 }}>
          <div className="graph-paper" style={{ width: widthPx, height: heightPx }}>
            <GraphSvg
              layout={frozenSize.current ? { ...layout, widthMm: sizeMm.w, heightMm: sizeMm.h } : layout}
              background
              svgRef={svgRef}
              widthCss={`${widthPx}px`}
              heightCss={`${heightPx}px`}
              interactive={interactive}
              style={SVG_STYLE}
            >
              {selShape && cropShapeId === selShape.id && selShape.kind === "image" && (
                <g className="ui-handles ui-crop" ref={shapeHandlesRef}>
                  <rect x={Math.min(selShape.x1, selShape.x2)} y={Math.min(selShape.y1, selShape.y2)} width={Math.abs(selShape.x2 - selShape.x1)} height={Math.abs(selShape.y2 - selShape.y1)} fill="none" stroke="#ff9500" strokeWidth={1.5 / pxPerMm} strokeDasharray="1 0.6" pointerEvents="none" />
                  {(["n", "e", "s", "w"] as const).map((side) => {
                    const cx = (selShape.x1 + selShape.x2) / 2;
                    const cy = (selShape.y1 + selShape.y2) / 2;
                    const x = side === "w" ? Math.min(selShape.x1, selShape.x2) : side === "e" ? Math.max(selShape.x1, selShape.x2) : cx;
                    const y = side === "n" ? Math.min(selShape.y1, selShape.y2) : side === "s" ? Math.max(selShape.y1, selShape.y2) : cy;
                    const horiz = side === "n" || side === "s";
                    return (
                      <rect
                        key={side}
                        x={x - (horiz ? handle : handle / 2)}
                        y={y - (horiz ? handle / 2 : handle)}
                        width={horiz ? handle * 2 : handle}
                        height={horiz ? handle : handle * 2}
                        fill="#ff9500"
                        stroke="#ffffff"
                        strokeWidth={1 / pxPerMm}
                        style={{ cursor: horiz ? "ns-resize" : "ew-resize" }}
                        onPointerDown={(e) => startCropHandle(selShape.layerId, selShape.id, side, e)}
                      />
                    );
                  })}
                </g>
              )}
              {selShape && !(cropShapeId === selShape.id && selShape.kind === "image") && (
                <g className="ui-handles" ref={shapeHandlesRef}>
                  {shapeHandles(selShape).map((h, i) => (
                    <rect
                      key={i}
                      x={h[0] - handle / 2}
                      y={h[1] - handle / 2}
                      width={handle}
                      height={handle}
                      fill="#ffffff"
                      stroke="#007aff"
                      strokeWidth={1 / pxPerMm}
                      style={{ cursor: "crosshair" }}
                      onPointerDown={(e) => startShapeHandle(selShape.layerId, selShape.id, i, e)}
                    />
                  ))}
                </g>
              )}
              {selLayer && (
                <g className="ui-handles" ref={layerHandlesRef}>
                  {(["nw", "ne", "sw", "se"] as const).map((c) => {
                    const x = c.includes("w") ? selLayer.frame.xMm : selLayer.frame.xMm + selLayer.frame.wMm;
                    const y = c.includes("n") ? selLayer.frame.yMm : selLayer.frame.yMm + selLayer.frame.hMm;
                    return (
                      <rect
                        key={c}
                        x={x - handle / 2}
                        y={y - handle / 2}
                        width={handle}
                        height={handle}
                        fill="#ffffff"
                        stroke="#007aff"
                        strokeWidth={1 / pxPerMm}
                        style={{ cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize" }}
                        onPointerDown={(e) => startResize(selLayer.id, c, e)}
                      />
                    );
                  })}
                </g>
              )}
            </GraphSvg>
            {guides && (guides.xs.length > 0 || guides.ys.length > 0) && (
              <svg viewBox={`0 0 ${layout.widthMm} ${layout.heightMm}`} width={widthPx} height={heightPx} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
                {guides.xs.map((x) => (
                  <line key={`x${x}`} x1={x} x2={x} y1={0} y2={layout.heightMm} stroke="#ff2d55" strokeWidth={1 / pxPerMm} strokeDasharray={`${3 / pxPerMm} ${2 / pxPerMm}`} />
                ))}
                {guides.ys.map((y) => (
                  <line key={`y${y}`} y1={y} y2={y} x1={0} x2={layout.widthMm} stroke="#ff2d55" strokeWidth={1 / pxPerMm} strokeDasharray={`${3 / pxPerMm} ${2 / pxPerMm}`} />
                ))}
              </svg>
            )}
            {drawTool && (
              <svg
                viewBox={`0 0 ${layout.widthMm} ${layout.heightMm}`}
                width={widthPx}
                height={heightPx}
                style={{ position: "absolute", left: 0, top: 0, cursor: "crosshair", touchAction: "none" }}
                onPointerDown={startDraw}
                onPointerMove={(e) => {
                  if (!polyDraft) return;
                  const [mx, my] = toMm(e);
                  setPolyDraft((d) => (d ? { ...d, cursor: { x: mx, y: my } } : d));
                }}
                onDoubleClick={() => polyDraft && finishPoly(true)}
              >
                {drawPreview?.trail && drawPreview.trail.length > 1 && (
                  <path d={smoothPath(drawPreview.trail.map((p): [number, number] => [p.x, p.y]), drawOpts.freehand, false)} fill="none" stroke="#007aff" strokeWidth={0.3} />
                )}
                {polyDraft && (
                  <>
                    <path
                      d={smoothPath([...polyDraft.points, ...(polyDraft.cursor ? [polyDraft.cursor] : [])].map((p): [number, number] => [p.x, p.y]), drawOpts.smoothing, polyDraft.tool === "polygon" && polyDraft.points.length >= 2)}
                      fill={polyDraft.tool === "polygon" ? "rgba(0,122,255,0.08)" : "none"}
                      stroke="#007aff"
                      strokeWidth={0.3}
                      strokeDasharray="1 0.6"
                    />
                    {polyDraft.points.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={i === 0 && polyDraft.tool === "polygon" ? 1.2 : 0.7} fill="#ffffff" stroke="#007aff" strokeWidth={0.3} />
                    ))}
                  </>
                )}
                {drawPreview && (drawPreview.tool === "line" || drawPreview.tool === "arrow") && (
                  <line x1={drawPreview.x1} y1={drawPreview.y1} x2={drawPreview.x2} y2={drawPreview.y2} stroke="#007aff" strokeWidth={0.3} strokeDasharray="1 0.6" />
                )}
                {drawPreview && drawPreview.tool === "rect" && (
                  <rect x={Math.min(drawPreview.x1, drawPreview.x2)} y={Math.min(drawPreview.y1, drawPreview.y2)} width={Math.abs(drawPreview.x2 - drawPreview.x1)} height={Math.abs(drawPreview.y2 - drawPreview.y1)} fill="rgba(0,122,255,0.08)" stroke="#007aff" strokeWidth={0.3} strokeDasharray="1 0.6" />
                )}
                {drawPreview && drawPreview.tool === "ellipse" && (
                  <ellipse cx={(drawPreview.x1 + drawPreview.x2) / 2} cy={(drawPreview.y1 + drawPreview.y2) / 2} rx={Math.abs(drawPreview.x2 - drawPreview.x1) / 2} ry={Math.abs(drawPreview.y2 - drawPreview.y1) / 2} fill="rgba(0,122,255,0.08)" stroke="#007aff" strokeWidth={0.3} strokeDasharray="1 0.6" />
                )}
              </svg>
            )}
            {picking && pickLayout && (
              <svg
                viewBox={`0 0 ${layout.widthMm} ${layout.heightMm}`}
                width={widthPx}
                height={heightPx}
                style={{ position: "absolute", left: 0, top: 0, cursor: "col-resize", touchAction: "none" }}
                {...pickPointer}
              >
                <rect x={0} y={0} width={layout.widthMm} height={layout.heightMm} fill="rgba(0,122,255,0.04)" />
                {pickDrag && (
                  <rect
                    x={Math.min(pickDrag.x0, pickDrag.x1)}
                    y={pickLayout.layer.frame.yMm}
                    width={Math.abs(pickDrag.x1 - pickDrag.x0)}
                    height={pickLayout.layer.frame.hMm}
                    fill="rgba(0,122,255,0.18)"
                    stroke="#007aff"
                    strokeWidth={1 / pxPerMm}
                  />
                )}
              </svg>
            )}
            {reader && (
              <div className="reader-tip" style={{ left: reader.xPx, top: reader.yPx }}>
                {reader.text}
              </div>
            )}
            {marquee && (
              <div
                style={{
                  position: "absolute",
                  left: marquee.x0 * pxPerMm,
                  top: marquee.y0 * pxPerMm,
                  width: (marquee.x1 - marquee.x0) * pxPerMm,
                  height: (marquee.y1 - marquee.y0) * pxPerMm,
                  border: "1px dashed var(--accent)",
                  background: "rgba(0,122,255,0.06)",
                  pointerEvents: "none",
                }}
              />
            )}
            {zoomRect && (
              <div
                style={{
                  position: "absolute",
                  left: Math.min(zoomRect.x0, zoomRect.x1) * pxPerMm,
                  top: Math.min(zoomRect.y0, zoomRect.y1) * pxPerMm,
                  width: Math.abs(zoomRect.x1 - zoomRect.x0) * pxPerMm,
                  height: Math.abs(zoomRect.y1 - zoomRect.y0) * pxPerMm,
                  border: "1px solid var(--accent)",
                  background: "rgba(0,122,255,0.12)",
                  pointerEvents: "none",
                }}
              />
            )}
            {edit && (
              <textarea
                ref={editInputRef}
                className="inline-editor"
                autoFocus
                defaultValue={edit.value}
                rows={Math.max(1, edit.value.split("\n").length)}
                style={{
                  position: "absolute",
                  left: edit.xPx,
                  top: edit.yPx,
                  width: edit.widthPx,
                  fontSize: edit.fontPx,
                  lineHeight: 1.2,
                  fontFamily: "Arial, Helvetica, sans-serif",
                  resize: "none",
                  overflow: "hidden",
                  transform: edit.rotate ? `rotate(${edit.rotate}deg)` : undefined,
                  transformOrigin: "0 0",
                }}
                onFocus={(e) => e.target.select()}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.rows = Math.max(1, el.value.split("\n").length);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (applyMarkupShortcut(e, () => {})) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    edit.commit((e.target as HTMLTextAreaElement).value);
                    setEdit(null);
                  } else if (e.key === "Escape") closeEditor(true);
                }}
                onBlur={(e) => {
                  edit.commit(e.target.value);
                  setEdit(null);
                }}
                onPointerDown={(e) => e.stopPropagation()}
              />
            )}
          </div>
        </div>
      </div>
      </Panel>
      {fitDialog && fitDialog.graphId === graph.id && (
        <>
          <Separator className="separator horizontal" />
          <Panel defaultSize={230} minSize={120} maxSize={480}>
            <FitPanel key={fitDialog.layerId} graphId={fitDialog.graphId} layerId={fitDialog.layerId} plotId={fitDialog.plotId} />
          </Panel>
        </>
      )}
      </Group>
      {picking && (
        <div className="pick-banner">
          Drag across the data area to choose the fit range
          <button className="btn small" onClick={() => useDialogs.getState().setRangePick(null)}>
            Cancel
          </button>
        </div>
      )}
      <PointerCapture onMove={onPointerMove} onUp={onPointerUp} />
      {menu}
    </div>
  );
}

/** Window-level move/up listeners so drags keep working when the pointer leaves the SVG. */
function PointerCapture({ onMove, onUp }: { onMove: (e: React.PointerEvent) => void; onUp: (e: React.PointerEvent) => void }) {
  useEffect(() => {
    const mv = (e: PointerEvent) => onMove(e as unknown as React.PointerEvent);
    const up = (e: PointerEvent) => onUp(e as unknown as React.PointerEvent);
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [onMove, onUp]);
  return null;
}
