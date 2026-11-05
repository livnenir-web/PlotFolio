import { memo, useMemo, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import type { Plot, Selection, TextItem, TextStyle } from "../../model/types";
import type { AxisGeom, GraphLayout, LayerLayout, LegendGeom } from "../layout";
import { markerRadiusMm, textItemBBox } from "../layout";
import { MarkupText } from "../textMarkup";
import { fmtMm, ptToMm } from "../units";
import { bandPath as areaPath, dashArray, linePath, type Pt, smoothPath, shapeSmoothing } from "../paths";
import { isLogScale } from "../ticks";
import { BarG, BoxG, ColorScaleG, ContourG, HeatmapG, barPatternId } from "./plots2d";
import { Layer3DG } from "./Layer3D";
import type { Shape } from "../../model/types";

export interface InteractiveProps {
  selection: Selection;
  /** additional selected objects (shift+click) */
  selections?: Selection[];
  /** "layer mode" (L held): layers are highlighted and clicks inside a frame go to the layer */
  layerMode?: boolean;
  onPointerDown: (sel: Selection, e: RPointerEvent<SVGElement>) => void;
  onDoubleClick: (sel: Selection, e: RPointerEvent<SVGElement> | React.MouseEvent<SVGElement>, target?: "title" | "legendEntry" | "text", extra?: string) => void;
}

export interface GraphSvgProps {
  layout: GraphLayout;
  /** Draw the paper background. Off for SVG export. */
  background: boolean;
  interactive?: InteractiveProps;
  svgRef?: React.Ref<SVGSVGElement>;
  style?: CSSProperties;
  children?: ReactNode;
  /** css width/height; defaults to physical mm size */
  widthCss?: string;
  heightCss?: string;
}

const HIT = "rgba(0,0,0,0)";

/**
 * Marker outline builder for a shape and radius. The parts that do not depend on the point are formatted
 * once, so a 5000-point scatter costs two number conversions per marker instead of eight.
 */
export function markerPathFn(shape: Plot["marker"]["shape"], r: number): (cx: number, cy: number) => string {
  const x = fmtMm;
  switch (shape) {
    case "square": {
      const s2 = x(2 * r);
      const sm2 = x(-2 * r);
      return (cx, cy) => `M${x(cx - r)} ${x(cy - r)}h${s2}v${s2}h${sm2}z`;
    }
    case "triangle":
      return (cx, cy) => {
        const yb = x(cy + r * 0.8);
        return `M${x(cx)} ${x(cy - r * 1.15)}L${x(cx + r * 1.1)} ${yb}L${x(cx - r * 1.1)} ${yb}z`;
      };
    case "diamond":
      return (cx, cy) => {
        const xc = x(cx);
        const yc = x(cy);
        return `M${xc} ${x(cy - r * 1.25)}L${x(cx + r * 1.25)} ${yc}L${xc} ${x(cy + r * 1.25)}L${x(cx - r * 1.25)} ${yc}z`;
      };
    case "cross":
      return (cx, cy) => {
        const x0 = x(cx - r);
        const x1 = x(cx + r);
        const y0 = x(cy - r);
        const y1 = x(cy + r);
        return `M${x0} ${y0}L${x1} ${y1}M${x0} ${y1}L${x1} ${y0}`;
      };
    case "plus":
      return (cx, cy) => `M${x(cx - r * 1.2)} ${x(cy)}H${x(cx + r * 1.2)}M${x(cx)} ${x(cy - r * 1.2)}V${x(cy + r * 1.2)}`;
    default: {
      const rr = x(r);
      const arc = `a${rr} ${rr} 0 1 0 ${x(2 * r)} 0a${rr} ${rr} 0 1 0 ${x(-2 * r)} 0z`;
      return (cx, cy) => `M${x(cx - r)} ${x(cy)}${arc}`;
    }
  }
}

export function markerPath(shape: Plot["marker"]["shape"], cx: number, cy: number, r: number): string {
  return markerPathFn(shape, r)(cx, cy);
}

/** Fill and outline of a plot's symbols (hollow shapes are drawn as outlines). */
export function markerStyle(p: Plot): { fill: string; stroke: string; strokeWidth: number } {
  const m = p.marker;
  const hollow = !m.filled || m.shape === "cross" || m.shape === "plus";
  const edgeW = m.edgeWidthPt != null && m.edgeWidthPt > 0 ? ptToMm(m.edgeWidthPt) : hollow ? ptToMm(Math.max(0.5, m.sizePt / 4)) : 0;
  const edge = m.edgeColor ?? p.color;
  return {
    fill: hollow ? "none" : (m.fillColor ?? p.color),
    stroke: edgeW > 0 ? edge : "none",
    strokeWidth: edgeW,
  };
}

function isSel(sel: Selection[] | undefined, pred: (s: Selection) => boolean): boolean {
  return !!sel && sel.some(pred);
}

const NO_PROPS = {};
const EMPTY_SEL: Selection[] = [];
/** Dev-only render counters (window.__renderStats) to verify that memoisation holds. */
export const renderStats = { svg: 0, layer: 0, plot: 0, axis: 0 };
type PdFn = (s: Selection) => object;
type DblFn = (s: Selection, target?: "title" | "legendEntry" | "text", extra?: string) => object;
const noPd: PdFn = () => NO_PROPS;
const noDbl: DblFn = () => NO_PROPS;

export function GraphSvg({ layout, background, interactive, svgRef, style, children, widthCss, heightCss }: GraphSvgProps) {
  renderStats.svg++;
  const { graph, widthMm: W, heightMm: H } = layout;
  const graphId = graph.id;
  const onPointerDown = interactive?.onPointerDown;
  const onDoubleClick = interactive?.onDoubleClick;
  // handler factories depend only on the (stable) callbacks, so memoised layers keep their props
  const pd = useMemo<PdFn>(() => (onPointerDown ? (s) => ({ onPointerDown: (e: RPointerEvent<SVGElement>) => onPointerDown(s, e) }) : noPd), [onPointerDown]);
  const dbl = useMemo<DblFn>(() => (onDoubleClick ? (s, target, extra) => ({ onDoubleClick: (e: React.MouseEvent<SVGElement>) => onDoubleClick(s, e, target, extra) }) : noDbl), [onDoubleClick]);
  // selections grouped per layer: a layer only re-renders when its own selection changes
  const selection = interactive?.selection;
  const selections = interactive?.selections;
  const byLayer = useMemo(() => {
    const m = new Map<string, Selection[]>();
    if (!selection) return m;
    for (const x of [selection, ...(selections ?? [])]) {
      if (!("layerId" in x)) continue;
      const arr = m.get(x.layerId);
      if (arr) arr.push(x);
      else m.set(x.layerId, [x]);
    }
    return m;
  }, [selection, selections]);
  const layerMode = !!interactive?.layerMode;
  const isInteractive = !!interactive;

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width={widthCss ?? `${fmtMm(W)}mm`}
      height={heightCss ?? `${fmtMm(H)}mm`}
      viewBox={`0 0 ${fmtMm(W)} ${fmtMm(H)}`}
      style={style}
      fontFamily="Arial, Helvetica, sans-serif"
    >
      {background && <rect className="paper" x={0} y={0} width={W} height={H} fill={graph.canvas.background} {...pd({ kind: "canvas", graphId })} />}
      {layout.layers.map((ll, i) => (
        <LayerG key={ll.layer.id} ll={ll} index={i} graphId={graphId} sel={byLayer.get(ll.layer.id) ?? EMPTY_SEL} layerMode={layerMode} interactive={isInteractive} pd={pd} dbl={dbl} />
      ))}
      {children}
    </svg>
  );
}

interface LayerProps {
  ll: LayerLayout;
  index: number;
  graphId: string;
  /** selections that belong to this layer */
  sel: Selection[];
  layerMode: boolean;
  interactive: boolean;
  pd: PdFn;
  dbl: DblFn;
}

/**
 * One layer. Memoised: it re-renders only when its layout, its own selections or layer mode change.
 * When interactive, frame-relative content is wrapped in `data-drag` groups that GraphView translates
 * during a drag preview (no React render per pointer move); export markup has no wrappers.
 */
const LayerG = memo(function LayerG({ ll, index, graphId, sel, layerMode, interactive, pd, dbl }: LayerProps) {
  renderStats.layer++;
  const { layer } = ll;
  const f = layer.frame;
  const layerId = layer.id;
  const clipId = `clip-${layer.id}`;
  const layerSel = { kind: "layer", graphId, layerId } as const;
  const layerSelected = isSel(sel, (x) => x.kind === "layer");
  const axisSelected = (which: string) => isSel(sel, (x) => x.kind === "axis" && x.axis === which);
  const frameContent = (
    <>
      {interactive && (
        <rect
          className="hit layer-hit"
          x={f.xMm}
          y={f.yMm}
          width={f.wMm}
          height={f.hMm}
          fill={HIT}
          style={{ cursor: "move" }}
          {...pd(layerSel)}
          {...dbl(layerSel)}
        />
      )}
      {ll.is3d ? (
        <Layer3DG ll={ll} graphId={graphId} sel={sel} interactive={interactive} pd={pd} dbl={dbl} />
      ) : (
        <>
          {[ll.x, ll.y, ll.y2].map((ag) => (ag ? <GridG key={ag.which} ll={ll} ag={ag} /> : null))}
          <g className="plots" clipPath={`url(#${clipId})`}>
            {layer.plots.map((p) => (
              <PlotG key={p.id} ll={ll} plot={p} graphId={graphId} selected={isSel(sel, (x) => x.kind === "plot" && x.plotId === p.id)} interactive={interactive} pd={pd} dbl={dbl} />
            ))}
          </g>
          {[ll.x, ll.y, ll.y2].map((ag) => (ag ? <AxisG key={ag.which} ll={ll} ag={ag} graphId={graphId} selected={axisSelected(ag.which)} interactive={interactive} pd={pd} dbl={dbl} /> : null))}
        </>
      )}
      {ll.colorScale && (
        <DragGroup id={interactive ? `colorScale:${layerId}` : null}>
          <ColorScaleG ll={ll} graphId={graphId} selected={isSel(sel, (x) => x.kind === "colorScale")} interactive={interactive} pd={pd} />
        </DragGroup>
      )}
      {interactive && layerSelected && (
        <rect className="ui-selection" x={f.xMm} y={f.yMm} width={f.wMm} height={f.hMm} fill="none" stroke="#007aff" strokeWidth={0.3} strokeDasharray="1.2 0.8" pointerEvents="none" />
      )}
      {layer.legend.visible && ll.legend.entries.length > 0 && (
        <DragGroup id={interactive ? `legend:${layerId}` : null}>
          <LegendG ll={ll} lg={ll.legend} graphId={graphId} selected={isSel(sel, (x) => x.kind === "legend")} interactive={interactive} pd={pd} dbl={dbl} />
        </DragGroup>
      )}
    </>
  );
  return (
    <g id={`layer-${index + 1}`} className="layer" data-layer-id={layer.id}>
      <defs>
        <clipPath id={clipId}>
          <rect x={f.xMm - 0.01} y={f.yMm - 0.01} width={f.wMm + 0.02} height={f.hMm + 0.02} />
        </clipPath>
      </defs>
      {(layer.shapes ?? []).some((s) => s.behindData) && (
        <g className="shapes shapes-back">
          {layer.shapes!.filter((s) => s.behindData).map((sh) => (
            <ShapeG key={sh.id} shape={sh} mm={ll.shapeMm.get(sh.id)} pointsMm={ll.shapePointsMm.get(sh.id)} graphId={graphId} layerId={layerId} selected={isSel(sel, (x) => x.kind === "shape" && x.shapeId === sh.id)} interactive={interactive} pd={pd} dbl={dbl} />
          ))}
        </g>
      )}
      {interactive ? <g data-drag={`frame:${layerId}`}>{frameContent}</g> : frameContent}
      {(layer.shapes ?? []).some((s) => !s.behindData) && (
        <g className="shapes">
          {layer.shapes!.filter((s) => !s.behindData).map((sh) => (
            <ShapeG key={sh.id} shape={sh} mm={ll.shapeMm.get(sh.id)} pointsMm={ll.shapePointsMm.get(sh.id)} graphId={graphId} layerId={layerId} selected={isSel(sel, (x) => x.kind === "shape" && x.shapeId === sh.id)} interactive={interactive} pd={pd} dbl={dbl} />
          ))}
        </g>
      )}
      {layer.texts.length > 0 && (
        <g className="texts">
          {layer.texts.map((t) => (
            <TextG key={t.id} t={t} pos={ll.textMm.get(t.id)} graphId={graphId} layerId={layerId} selected={isSel(sel, (x) => x.kind === "text" && x.textId === t.id)} interactive={interactive} pd={pd} dbl={dbl} />
          ))}
        </g>
      )}
      {layerMode && (
        <g className="ui-layer-mode" data-drag={`frame:${layerId}`} style={{ cursor: "move" }} {...pd(layerSel)}>
          <rect x={f.xMm} y={f.yMm} width={f.wMm} height={f.hMm} fill="rgba(255,149,0,0.14)" stroke="#ff9500" strokeWidth={0.4} />
          <rect x={f.xMm} y={f.yMm - 3.2} width={Math.max(10, layer.name.length * 1.6 + 2)} height={3.2} fill="#ff9500" />
          <text x={f.xMm + 1} y={f.yMm - 0.9} fontSize={2.2} fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif" style={{ userSelect: "none" }}>
            {layer.name}
          </text>
        </g>
      )}
    </g>
  );
});

/** Wrapper that only exists in interactive renders, so drag previews can translate it. */
function DragGroup({ id, children }: { id: string | null; children: ReactNode }) {
  return id ? <g data-drag={id}>{children}</g> : <>{children}</>;
}

const TextG = memo(function TextG({ t, pos: posIn, graphId, layerId, selected, interactive, pd, dbl }: { t: TextItem; pos: { x: number; y: number } | undefined; graphId: string; layerId: string; selected: boolean; interactive: boolean; pd: PdFn; dbl: DblFn }) {
  const s: Selection = { kind: "text", graphId, layerId, textId: t.id };
  const pos = posIn ?? { x: t.xMm, y: t.yMm };
  const tb = selected ? textItemBBox({ ...t, xMm: pos.x, yMm: pos.y }) : null;
  return (
    <g className="text-item" data-text-id={t.id} {...pd(s)} {...dbl(s, "text")} style={interactive ? { cursor: "move" } : undefined}>
      <MarkupText text={t.text} x={pos.x} y={pos.y} style={t.style} anchor={t.anchor} rotate={t.rotation} />
      {tb && (
        <rect x={fmtMm(tb.x0 - 0.5)} y={fmtMm(tb.y0 - 0.3)} width={fmtMm(tb.x1 - tb.x0 + 1)} height={fmtMm(tb.y1 - tb.y0 + 0.6)} fill="none" stroke="#007aff" strokeWidth={0.25} strokeDasharray="1 0.6" pointerEvents="none" />
      )}
    </g>
  );
});

/** Arrow head as a filled triangle at (x, y) pointing along (dx, dy). */
function headPath(x: number, y: number, dx: number, dy: number, size: number): string {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x - ux * size;
  const by = y - uy * size;
  const w = size * 0.4;
  return `M${fmtMm(x)} ${fmtMm(y)}L${fmtMm(bx - uy * w)} ${fmtMm(by + ux * w)}L${fmtMm(bx + uy * w)} ${fmtMm(by - ux * w)}Z`;
}

export function shapeGeometry(sh: Shape) {
  const x = Math.min(sh.x1, sh.x2);
  const y = Math.min(sh.y1, sh.y2);
  return { x, y, w: Math.abs(sh.x2 - sh.x1), h: Math.abs(sh.y2 - sh.y1) };
}

const ShapeG = memo(function ShapeG({ shape, mm, pointsMm, graphId, layerId, selected, interactive, pd, dbl }: { shape: Shape; mm: { x1: number; y1: number; x2: number; y2: number } | undefined; pointsMm?: { x: number; y: number }[]; graphId: string; layerId: string; selected: boolean; interactive: boolean; pd: PdFn; dbl: DblFn }) {
  const sh: Shape = mm ? { ...shape, ...mm } : shape;
  const s: Selection = { kind: "shape", graphId, layerId, shapeId: sh.id };
  const lw = ptToMm(sh.strokeWidthPt);
  const dasharray = dashArray({ style: sh.dash, dashPt: sh.dashPt }, lw);
  const common = { className: `shape shape-${sh.kind}`, "data-shape-id": sh.id, ...pd(s), ...dbl(s), style: interactive ? { cursor: "move" as const } : undefined };
  if (sh.kind === "line" || sh.kind === "arrow") {
    const dx = sh.x2 - sh.x1;
    const dy = sh.y2 - sh.y1;
    const len = Math.hypot(dx, dy) || 1;
    // shorten the line under the heads so the tip is crisp
    const t0 = sh.headStart ? (sh.headSizeMm * 0.8) / len : 0;
    const t1 = sh.headEnd ? (sh.headSizeMm * 0.8) / len : 0;
    const ax = sh.x1 + dx * t0;
    const ay = sh.y1 + dy * t0;
    const bx = sh.x2 - dx * t1;
    const by = sh.y2 - dy * t1;
    return (
      <g {...common}>
        <line x1={fmtMm(ax)} y1={fmtMm(ay)} x2={fmtMm(bx)} y2={fmtMm(by)} stroke={sh.stroke} strokeWidth={lw} strokeDasharray={dasharray} strokeLinecap="round" />
        {sh.headEnd && <path d={headPath(sh.x2, sh.y2, dx, dy, sh.headSizeMm)} fill={sh.stroke} stroke="none" />}
        {sh.headStart && <path d={headPath(sh.x1, sh.y1, -dx, -dy, sh.headSizeMm)} fill={sh.stroke} stroke="none" />}
        {interactive && <line className="hit" x1={fmtMm(sh.x1)} y1={fmtMm(sh.y1)} x2={fmtMm(sh.x2)} y2={fmtMm(sh.y2)} stroke={HIT} strokeWidth={Math.max(lw + 1.5, 2)} />}
        {selected && <line x1={fmtMm(sh.x1)} y1={fmtMm(sh.y1)} x2={fmtMm(sh.x2)} y2={fmtMm(sh.y2)} stroke="#007aff" strokeOpacity={0.4} strokeWidth={lw + 0.8} pointerEvents="none" />}
      </g>
    );
  }
  const g = shapeGeometry(sh);
  if (sh.kind === "polyline" || sh.kind === "polygon" || sh.kind === "freehand") {
    const pts = (pointsMm ?? sh.points ?? []).map((p): [number, number] => [p.x, p.y]);
    if (pts.length < 2) return null;
    const closed = sh.kind === "polygon";
    const d = smoothPath(pts, shapeSmoothing(sh), closed);
    const fillable = closed && sh.fill;
    return (
      <g {...common}>
        <path d={d} fill={fillable ? sh.fill! : "none"} fillOpacity={fillable ? sh.fillOpacity : undefined} stroke={sh.stroke} strokeWidth={lw} strokeDasharray={dasharray} strokeLinejoin="round" strokeLinecap="round" />
        {interactive && <path className="hit" d={d} fill={fillable || selected ? HIT : "none"} stroke={HIT} strokeWidth={Math.max(lw + 1.5, 2)} style={{ pointerEvents: fillable || selected ? "all" : "stroke" }} />}
        {selected && <path d={d} fill="none" stroke="#007aff" strokeOpacity={0.4} strokeWidth={lw + 0.8} pointerEvents="none" />}
      </g>
    );
  }
  if (sh.kind === "image") {
    return (
      <g {...common} data-name={sh.name}>
        {sh.href && !sh.crop && <image href={sh.href} x={fmtMm(g.x)} y={fmtMm(g.y)} width={fmtMm(g.w)} height={fmtMm(g.h)} preserveAspectRatio="none" opacity={sh.opacity !== undefined && sh.opacity < 1 ? sh.opacity : undefined} />}
        {sh.href && sh.crop && (
          // a nested viewport whose viewBox is the cropped region of the full picture
          <svg x={fmtMm(g.x)} y={fmtMm(g.y)} width={fmtMm(g.w)} height={fmtMm(g.h)} viewBox={`${(sh.crop.x * (sh.naturalW ?? 1000)).toFixed(2)} ${(sh.crop.y * (sh.naturalH ?? 1000)).toFixed(2)} ${(sh.crop.w * (sh.naturalW ?? 1000)).toFixed(2)} ${(sh.crop.h * (sh.naturalH ?? 1000)).toFixed(2)}`} preserveAspectRatio="none" opacity={sh.opacity !== undefined && sh.opacity < 1 ? sh.opacity : undefined}>
            <image href={sh.href} x={0} y={0} width={sh.naturalW ?? 1000} height={sh.naturalH ?? 1000} preserveAspectRatio="none" />
          </svg>
        )}
        {!sh.href && <rect x={fmtMm(g.x)} y={fmtMm(g.y)} width={fmtMm(g.w)} height={fmtMm(g.h)} fill="#eeeeee" stroke="#999999" strokeWidth={0.2} strokeDasharray="1 0.6" />}
        {sh.strokeWidthPt > 0 && <rect x={fmtMm(g.x)} y={fmtMm(g.y)} width={fmtMm(g.w)} height={fmtMm(g.h)} fill="none" stroke={sh.stroke} strokeWidth={lw} strokeDasharray={dasharray} />}
        {interactive && <rect className="hit" x={fmtMm(g.x)} y={fmtMm(g.y)} width={fmtMm(g.w)} height={fmtMm(g.h)} fill={HIT} stroke="none" />}
        {selected && <rect x={fmtMm(g.x)} y={fmtMm(g.y)} width={fmtMm(g.w)} height={fmtMm(g.h)} fill="none" stroke="#007aff" strokeWidth={0.25} strokeDasharray="1 0.6" pointerEvents="none" />}
      </g>
    );
  }
  const fill = sh.fill ?? "none";
  return (
    <g {...common}>
      {sh.kind === "rect" ? (
        <rect x={fmtMm(g.x)} y={fmtMm(g.y)} width={fmtMm(g.w)} height={fmtMm(g.h)} rx={sh.cornerRadiusMm ? fmtMm(Math.min(sh.cornerRadiusMm, g.w / 2, g.h / 2)) : undefined} fill={fill} fillOpacity={sh.fill ? sh.fillOpacity : undefined} stroke={sh.stroke} strokeWidth={lw} strokeDasharray={dasharray} />
      ) : (
        <ellipse cx={fmtMm(g.x + g.w / 2)} cy={fmtMm(g.y + g.h / 2)} rx={fmtMm(g.w / 2)} ry={fmtMm(g.h / 2)} fill={fill} fillOpacity={sh.fill ? sh.fillOpacity : undefined} stroke={sh.stroke} strokeWidth={lw} strokeDasharray={dasharray} />
      )}
      {interactive && (
        // unfilled shapes are grabbed by their outline; once selected, the interior can be dragged too
        <rect className="hit" x={fmtMm(g.x - 0.5)} y={fmtMm(g.y - 0.5)} width={fmtMm(g.w + 1)} height={fmtMm(g.h + 1)} fill={sh.fill || selected ? HIT : "none"} stroke={HIT} strokeWidth={2} style={{ pointerEvents: sh.fill || selected ? "all" : "stroke" }} />
      )}
      {selected && <rect x={fmtMm(g.x)} y={fmtMm(g.y)} width={fmtMm(g.w)} height={fmtMm(g.h)} fill="none" stroke="#007aff" strokeWidth={0.25} strokeDasharray="1 0.6" pointerEvents="none" />}
    </g>
  );
});

function GridG({ ll, ag }: { ll: LayerLayout; ag: AxisGeom }) {
  if (!ag.axis.grid) return null;
  const f = ll.layer.frame;
  const w = ptToMm(0.25);
  return (
    <g className={`grid grid-${ag.which}`} stroke="#cccccc" strokeWidth={w} fill="none">
      {ag.scale.major.map((v) => {
        const r = ag.scale.map(v);
        if (r === null) return null;
        return ag.which === "x" ? <line key={v} x1={r} x2={r} y1={f.yMm} y2={f.yMm + f.hMm} /> : <line key={v} y1={r} y2={r} x1={f.xMm} x2={f.xMm + f.wMm} />;
      })}
    </g>
  );
}

const PlotG = memo(function PlotG({ ll, plot, graphId, selected, interactive, pd, dbl }: { ll: LayerLayout; plot: Plot; graphId: string; selected: boolean; interactive: boolean; pd: PdFn; dbl: DblFn }) {
  renderStats.plot++;
  if (!plot.visible) return null;
  const s: Selection = { kind: "plot", graphId, layerId: ll.layer.id, plotId: plot.id };
  const xs = ll.x.scale;
  const ys = plot.yAxis === "y2" && ll.y2 ? ll.y2.scale : ll.y.scale;
  const color = plot.color;
  const common = { className: "plot", "data-name": plot.name, "data-plot-id": plot.id, ...pd(s), ...dbl(s) };

  if (plot.type === "heatmap" || plot.type === "contour" || plot.type === "bar" || plot.type === "box") {
    const f = ll.layer.frame;
    return (
      <g {...common}>
        {plot.type === "heatmap" && <HeatmapG ll={ll} plot={plot} />}
        {plot.type === "contour" && <ContourG ll={ll} plot={plot} />}
        {plot.type === "bar" && <BarG ll={ll} plot={plot} interactive={interactive} />}
        {plot.type === "box" && <BoxG ll={ll} plot={plot} />}
        {interactive && (plot.type === "heatmap" || plot.type === "contour") && <rect className="hit" x={f.xMm} y={f.yMm} width={f.wMm} height={f.hMm} fill={HIT} />}
        {selected && <HaloRect ll={ll} />}
      </g>
    );
  }
  if (plot.type === "surface3d" || plot.type === "scatter3d") return null;
  if (plot.type === "histogram") {
    const bins = ll.bins.get(plot.id) ?? [];
    const y0 = ys.map(isLogScale(ys.scale) ? Math.max(ys.from, Number.MIN_VALUE) : Math.max(0, Math.min(ys.from, ys.to))) ?? ll.layer.frame.yMm + ll.layer.frame.hMm;
    const lw = ptToMm(plot.line.widthPt);
    return (
      <g {...common}>
        <g className="bars" fill={plot.histogram?.filled ? color : "none"} stroke={color} strokeWidth={lw}>
          {bins.map((b, i) => {
            const x0 = xs.map(b.x0);
            const x1 = xs.map(b.x1);
            const y1 = ys.map(b.value);
            if (x0 === null || x1 === null || y1 === null) return null;
            const top = Math.min(y0, y1);
            return <rect key={i} x={fmtMm(Math.min(x0, x1))} y={fmtMm(top)} width={fmtMm(Math.abs(x1 - x0))} height={fmtMm(Math.abs(y1 - y0))} />;
          })}
        </g>
        {selected && <HaloRect ll={ll} />}
      </g>
    );
  }

  const d = ll.data.get(plot.id);
  if (!d) return null;
  const pts: ([number, number] | null)[] = d.x.map((xv, i) => {
    const px = xs.map(xv);
    const py = ys.map(d.y[i]);
    return px === null || py === null ? null : [px, py];
  });

  const lw = ptToMm(plot.line.widthPt);
  const path = plot.showLine ? linePath(pts, plot.line.connect ?? "straight") : "";
  const r = markerRadiusMm(plot);
  const mstyle = markerStyle(plot);
  // drop lines and data labels
  const dropLines = plot.dropLines && (plot.dropLines.toX || plot.dropLines.toY) ? buildDropLines(pts, plot.dropLines, ll, plot) : "";
  const labelNodes = plot.labels?.show ? dataLabelNodes(pts, d, plot, ll) : null;

  // error bars, or a shaded band between y − err and y + err
  const errSegs: string[] = [];
  const asBand = plot.errorBars.style === "band";
  let errBand = "";
  if (plot.errorBars.show && asBand && d.yErr) {
    const up: Pt[] = d.x.map((xv, i) => {
      const px = xs.map(xv);
      const py = ys.map(d.y[i] + (d.yErr![i] > 0 ? d.yErr![i] : 0));
      return px === null || py === null ? null : [px, py];
    });
    const lo: Pt[] = d.x.map((xv, i) => {
      const px = xs.map(xv);
      const py = ys.map(d.y[i] - (d.yErr![i] > 0 ? d.yErr![i] : 0));
      return px === null || py === null ? null : [px, py];
    });
    errBand = areaPath(up, lo, plot.errorBars.bandConnect ?? "straight");
  }
  if (plot.errorBars.show && (d.yErr || d.xErr)) {
    const cap = plot.errorBars.capMm / 2;
    for (let i = 0; i < d.x.length; i++) {
      const p = pts[i];
      if (!p) continue;
      if (d.yErr && d.yErr[i] > 0 && !asBand) {
        const lo = ys.map(d.y[i] - d.yErr[i]);
        const hi = ys.map(d.y[i] + d.yErr[i]);
        if (hi !== null) errSegs.push(`M${fmtMm(p[0])} ${fmtMm(p[1])}V${fmtMm(hi)}M${fmtMm(p[0] - cap)} ${fmtMm(hi)}H${fmtMm(p[0] + cap)}`);
        if (lo !== null) errSegs.push(`M${fmtMm(p[0])} ${fmtMm(p[1])}V${fmtMm(lo)}M${fmtMm(p[0] - cap)} ${fmtMm(lo)}H${fmtMm(p[0] + cap)}`);
      }
      if (d.xErr && d.xErr[i] > 0) {
        const lo = xs.map(d.x[i] - d.xErr[i]);
        const hi = xs.map(d.x[i] + d.xErr[i]);
        if (hi !== null) errSegs.push(`M${fmtMm(p[0])} ${fmtMm(p[1])}H${fmtMm(hi)}M${fmtMm(hi)} ${fmtMm(p[1] - cap)}V${fmtMm(p[1] + cap)}`);
        if (lo !== null) errSegs.push(`M${fmtMm(p[0])} ${fmtMm(p[1])}H${fmtMm(lo)}M${fmtMm(lo)} ${fmtMm(p[1] - cap)}V${fmtMm(p[1] + cap)}`);
      }
    }
  }

  const mk = plot.showMarkers && plot.marker.shape !== "none" ? markerPathFn(plot.marker.shape, r) : null;
  const markersPath = mk ? pts.map((p) => (p ? mk(p[0], p[1]) : "")).join("") : "";
  // colour by a column: one path per distinct colour
  const mapper = plot.colorBy?.colId ? ll.colors.get(plot.id) : undefined;
  const colorGroups = mk && mapper && d.colorVals ? groupByColor(pts, d.colorVals, mapper, mk) : null;

  let predPath = "";
  if (plot.type === "fitCurve" && plot.fit?.showPredBand && plot.fit.predLower && plot.fit.predUpper && plot.fit.curveX) {
    const fx = plot.fit.curveX;
    const up: Pt[] = fx.map((xv, i) => {
      const px = xs.map(xv);
      const py = ys.map(plot.fit!.predUpper![i]);
      return px === null || py === null ? null : [px, py];
    });
    const lo: Pt[] = fx.map((xv, i) => {
      const px = xs.map(xv);
      const py = ys.map(plot.fit!.predLower![i]);
      return px === null || py === null ? null : [px, py];
    });
    predPath = areaPath(up, lo, "straight");
  }
  let bandPath = "";
  if (plot.type === "fitCurve" && plot.fit?.showBand && plot.fit.bandLower && plot.fit.bandUpper && plot.fit.curveX) {
    const fx = plot.fit.curveX;
    const up: ([number, number] | null)[] = fx.map((xv, i) => {
      const px = xs.map(xv);
      const py = ys.map(plot.fit!.bandUpper![i]);
      return px === null || py === null ? null : [px, py];
    });
    const lo: ([number, number] | null)[] = fx.map((xv, i) => {
      const px = xs.map(xv);
      const py = ys.map(plot.fit!.bandLower![i]);
      return px === null || py === null ? null : [px, py];
    });
    const upPts = up.filter((p): p is [number, number] => !!p);
    const loPts = lo.filter((p): p is [number, number] => !!p).reverse();
    if (upPts.length > 1 && loPts.length > 1) bandPath = linePath(upPts, "straight") + linePath(loPts, "straight").replace(/^M/, "L") + "Z";
  }

  return (
    <g {...common}>
      {predPath && (
        <g className="prediction-band">
          <path d={predPath} fill={color} fillOpacity={0.07} stroke={color} strokeOpacity={0.35} strokeWidth={ptToMm(0.5)} strokeDasharray="1.2 0.8" />
        </g>
      )}
      {bandPath && (
        <g className="confidence-band">
          <path d={bandPath} fill={color} fillOpacity={0.15} stroke="none" />
        </g>
      )}
      {errBand && (
        <g className="error-band">
          <path d={errBand} fill={plot.errorBars.bandColor ?? color} fillOpacity={plot.errorBars.bandOpacity ?? 0.2} stroke={plot.errorBars.bandOutline ? (plot.errorBars.bandColor ?? color) : "none"} strokeWidth={plot.errorBars.bandOutline ? ptToMm(plot.errorBars.widthPt) : undefined} strokeLinejoin="round" />
        </g>
      )}
      {selected && path && <path className="halo" d={path} fill="none" stroke="#007aff" strokeOpacity={0.35} strokeWidth={lw + 1} strokeLinejoin="round" />}
      {errSegs.length > 0 && (
        <g className="error-bars" stroke={color} strokeWidth={ptToMm(plot.errorBars.widthPt)} fill="none">
          <path d={errSegs.join("")} />
        </g>
      )}
      {path && (
        <g className="line" strokeOpacity={plot.line.opacity != null && plot.line.opacity < 1 ? plot.line.opacity : undefined}>
          <path d={path} fill="none" stroke={color} strokeWidth={lw} strokeDasharray={dashArray(plot.line, lw)} strokeLinejoin="round" strokeLinecap="round" />
        </g>
      )}
      {dropLines && (
        <g className="drop-lines">
          <path d={dropLines} fill="none" stroke={color} strokeWidth={ptToMm(0.5)} strokeOpacity={0.6} />
        </g>
      )}
      {markersPath && (
        <g className="markers" fill={mstyle.fill} stroke={mstyle.stroke} strokeWidth={mstyle.strokeWidth} opacity={plot.marker.opacity != null && plot.marker.opacity < 1 ? plot.marker.opacity : undefined}>
          {selected && <path className="halo" d={markersPath} fill="none" stroke="#007aff" strokeOpacity={0.35} strokeWidth={0.8} />}
          {colorGroups ? colorGroups.map((g) => <path key={g.color} d={g.d} fill={mstyle.fill === "none" ? "none" : g.color} stroke={mstyle.stroke === "none" ? "none" : plot.marker.edgeColor ?? g.color} />) : <path d={markersPath} />}
        </g>
      )}
      {labelNodes && <g className="data-labels">{labelNodes}</g>}
      {interactive && path && <path className="hit" d={path} fill="none" stroke={HIT} strokeWidth={Math.max(lw + 1.2, 1.5)} style={{ pointerEvents: "stroke" }} />}
      {interactive && markersPath && <path className="hit" d={(() => { const hp = markerPathFn("circle", Math.max(r, 0.6) + 0.4); return pts.map((p) => (p ? hp(p[0], p[1]) : "")).join(""); })()} fill={HIT} stroke="none" />}
    </g>
  );
});

function HaloRect({ ll }: { ll: LayerLayout }) {
  const f = ll.layer.frame;
  return <rect x={f.xMm} y={f.yMm} width={f.wMm} height={f.hMm} fill="none" stroke="#007aff" strokeOpacity={0.5} strokeWidth={0.3} strokeDasharray="1 0.6" />;
}

const AxisG = memo(function AxisG({ ll, ag, graphId, selected, interactive, pd, dbl }: { ll: LayerLayout; ag: AxisGeom; graphId: string; selected: boolean; interactive: boolean; pd: PdFn; dbl: DblFn }) {
  renderStats.axis++;
  const { axis, scale } = ag;
  if (!axis.visible) return null;
  const f = ll.layer.frame;
  const s: Selection = { kind: "axis", graphId, layerId: ll.layer.id, axis: ag.which };
  const lw = Number(ptToMm(axis.lineWidthPt).toFixed(4));
  const isX = ag.which === "x";
  const a0 = isX ? f.xMm : f.yMm + f.hMm;
  const a1 = isX ? f.xMm + f.wMm : f.yMm;

  const tickLine = (r: number, len: number, inward: boolean, key: string | number) => {
    const o = ag.side * (inward ? -len : len);
    return isX ? <line key={key} x1={fmtMm(r)} x2={fmtMm(r)} y1={fmtMm(ag.line)} y2={fmtMm(ag.line + o)} /> : <line key={key} y1={fmtMm(r)} y2={fmtMm(r)} x1={fmtMm(ag.line)} x2={fmtMm(ag.line + o)} />;
  };
  const inward = axis.tickDir === "in";
  const majorLen = axis.tickDir === "none" ? 0 : axis.majorTickMm;
  const majors = scale.major.map((v) => scale.map(v)).filter((r): r is number => r !== null);
  const minors = scale.minor.map((v) => scale.map(v)).filter((r): r is number => r !== null);

  // axis line split around gaps
  const lineSegs = scale.segments.map((seg, i) =>
    isX ? <line key={i} x1={fmtMm(seg.r0)} x2={fmtMm(seg.r1)} y1={fmtMm(ag.line)} y2={fmtMm(ag.line)} /> : <line key={i} y1={fmtMm(seg.r0)} y2={fmtMm(seg.r1)} x1={fmtMm(ag.line)} x2={fmtMm(ag.line)} />,
  );
  const mirrorLine = isX ? f.yMm : ag.which === "y" ? f.xMm + f.wMm : f.xMm;
  const mirrorSegs = axis.mirror
    ? scale.segments.map((seg, i) =>
        isX ? <line key={i} x1={fmtMm(seg.r0)} x2={fmtMm(seg.r1)} y1={fmtMm(mirrorLine)} y2={fmtMm(mirrorLine)} /> : <line key={i} y1={fmtMm(seg.r0)} y2={fmtMm(seg.r1)} x1={fmtMm(mirrorLine)} x2={fmtMm(mirrorLine)} />,
      )
    : [];
  const mirrorTick = (r: number, len: number, key: string | number) => {
    const o = -ag.side * (inward ? -len : len);
    return isX ? <line key={key} x1={fmtMm(r)} x2={fmtMm(r)} y1={fmtMm(mirrorLine)} y2={fmtMm(mirrorLine + o)} /> : <line key={key} y1={fmtMm(r)} y2={fmtMm(r)} x1={fmtMm(mirrorLine)} x2={fmtMm(mirrorLine + o)} />;
  };

  // break markers: short slanted strokes at each gap
  const breakMarks = scale.gaps.map(([g0, g1], i) => {
    const sz = 0.8;
    if (isX)
      return (
        <g key={i}>
          <line x1={fmtMm(g0 - sz / 2)} y1={fmtMm(ag.line + sz)} x2={fmtMm(g0 + sz / 2)} y2={fmtMm(ag.line - sz)} />
          <line x1={fmtMm(g1 - sz / 2)} y1={fmtMm(ag.line + sz)} x2={fmtMm(g1 + sz / 2)} y2={fmtMm(ag.line - sz)} />
        </g>
      );
    return (
      <g key={i}>
        <line y1={fmtMm(g0 - sz / 2)} x1={fmtMm(ag.line + sz)} y2={fmtMm(g0 + sz / 2)} x2={fmtMm(ag.line - sz)} />
        <line y1={fmtMm(g1 - sz / 2)} x1={fmtMm(ag.line + sz)} y2={fmtMm(g1 + sz / 2)} x2={fmtMm(ag.line - sz)} />
      </g>
    );
  });

  const hitThickness = ag.tickOut + 1.5;
  const hitRect = isX
    ? { x: Math.min(a0, a1), y: ag.line - 1, width: Math.abs(a1 - a0), height: hitThickness + 1 }
    : { x: ag.side < 0 ? ag.line - hitThickness : ag.line - 1, y: Math.min(a0, a1), width: hitThickness + 1, height: Math.abs(a1 - a0) };
  const labelHit = isX
    ? { x: ag.bbox.x0, y: ag.labelPos - 0.3, width: ag.bbox.x1 - ag.bbox.x0, height: ag.labelExtent + 0.6 }
    : { x: ag.side < 0 ? ag.labelPos - ag.labelExtent - 0.3 : ag.labelPos - 0.3, y: ag.bbox.y0, width: ag.labelExtent + 0.6, height: ag.bbox.y1 - ag.bbox.y0 };
  const titleHit = isX
    ? { x: f.xMm, y: ag.titlePos - 0.3, width: f.wMm, height: ag.titleExtent + 0.6 }
    : { x: ag.side < 0 ? ag.titlePos - ag.titleExtent - 0.3 : ag.titlePos - 0.3, y: f.yMm, width: ag.titleExtent + 0.6, height: f.hMm };

  const center = isX ? f.xMm + f.wMm / 2 : f.yMm + f.hMm / 2;

  return (
    <g className={`axis axis-${ag.which}`}>
      <g className="axis-line" stroke={axis.color} strokeWidth={lw} fill="none" strokeLinecap="square">
        {lineSegs}
        {mirrorSegs}
      </g>
      {majorLen > 0 && majors.length > 0 && (
        <g className="ticks major" stroke={axis.color} strokeWidth={lw} fill="none">
          {majors.map((r, i) => tickLine(r, majorLen, inward, i))}
          {axis.mirror && majors.map((r, i) => mirrorTick(r, majorLen, `m${i}`))}
        </g>
      )}
      {ag.minorLen > 0 && minors.length > 0 && (
        <g className="ticks minor" stroke={axis.color} strokeWidth={lw} fill="none">
          {minors.map((r, i) => tickLine(r, ag.minorLen, inward, i))}
          {axis.mirror && minors.map((r, i) => mirrorTick(r, ag.minorLen, `m${i}`))}
        </g>
      )}
      {breakMarks.length > 0 && (
        <g className="breaks" stroke={axis.color} strokeWidth={lw} fill="none">
          {breakMarks}
        </g>
      )}
      {ag.labels.length > 0 && (
        <g className="tick-labels">
          {ag.labels.map((t) => {
            const rot = axis.labelRotation ?? 0;
            if (isX)
              return rot ? (
                // rotated labels hang from their end (right side up) or start, like a tilted tag
                <MarkupText key={t.value} text={t.text} x={t.r + (t.shift ?? 0)} y={ag.labelPos + ptToMm(axis.tickLabelStyle.sizePt) * 0.5} style={axis.tickLabelStyle} anchor={rot > 0 ? "end" : "start"} vAnchor="middle" rotate={-Math.abs(rot) * Math.sign(rot)} />
              ) : (
                <MarkupText key={t.value} text={t.text} x={t.r + (t.shift ?? 0)} y={ag.labelPos} style={axis.tickLabelStyle} anchor={t.anchor ?? "middle"} vAnchor="hanging" />
              );
            return <MarkupText key={t.value} text={t.text} x={ag.labelPos} y={t.r + (t.shift ?? 0) * 2} style={axis.tickLabelStyle} anchor={ag.side < 0 ? "end" : "start"} vAnchor="middle" rotate={rot || undefined} />;
          })}
        </g>
      )}
      {axis.showTitle && axis.title && (
        <g className="axis-title">
          {isX ? (
            <MarkupText text={axis.title} x={center} y={ag.titlePos} style={axis.titleStyle} anchor="middle" vAnchor="hanging" />
          ) : (
            <MarkupText
              text={axis.title}
              x={ag.side < 0 ? ag.titlePos - ag.titleExtent + ptToMm(axis.titleStyle.sizePt) * 0.85 : ag.titlePos + ptToMm(axis.titleStyle.sizePt) * 0.85}
              y={center}
              style={axis.titleStyle}
              anchor="middle"
              rotate={ag.side < 0 ? -90 : 90}
            />
          )}
        </g>
      )}
      {interactive && (
        <g className="hit">
          <rect {...hitRect} fill={HIT} {...pd(s)} {...dbl(s)} />
          {ag.labels.length > 0 && <rect {...labelHit} fill={HIT} {...pd(s)} {...dbl(s)} />}
          {axis.showTitle && axis.title && <rect {...titleHit} fill={HIT} style={{ cursor: "text" }} {...pd(s)} {...dbl(s, "title")} />}
          {selected && (
            <rect
              x={fmtMm(Math.min(hitRect.x, titleHit.x, labelHit.x))}
              y={fmtMm(Math.min(hitRect.y, titleHit.y, labelHit.y))}
              width={fmtMm(Math.max(hitRect.x + hitRect.width, titleHit.x + titleHit.width, labelHit.x + labelHit.width) - Math.min(hitRect.x, titleHit.x, labelHit.x))}
              height={fmtMm(Math.max(hitRect.y + hitRect.height, titleHit.y + titleHit.height, labelHit.y + labelHit.height) - Math.min(hitRect.y, titleHit.y, labelHit.y))}
              fill="none"
              stroke="#007aff"
              strokeWidth={0.25}
              strokeDasharray="1 0.6"
              pointerEvents="none"
            />
          )}
        </g>
      )}
    </g>
  );
});

const LegendG = memo(function LegendG({ ll, lg, graphId, selected, interactive, pd, dbl }: { ll: LayerLayout; lg: LegendGeom; graphId: string; selected: boolean; interactive: boolean; pd: PdFn; dbl: DblFn }) {
  const legend = ll.layer.legend;
  const s: Selection = { kind: "legend", graphId, layerId: ll.layer.id };
  const style: TextStyle = legend.style;
  const pad = lg.pad;
  return (
    <g className="legend" transform={`translate(${fmtMm(lg.x)} ${fmtMm(lg.y)})`} style={interactive ? { cursor: "move" } : undefined} {...pd(s)}>
      {(legend.background || legend.border) && (
        <rect x={0} y={0} width={fmtMm(lg.w)} height={fmtMm(lg.h)} fill={legend.background ? "#ffffff" : "none"} stroke={legend.border ? "#000000" : "none"} strokeWidth={ptToMm(0.5)} />
      )}
      {lg.entries.map((e) => {
        const p = e.plot;
        const cy = e.y + lg.rowH / 2;
        const x0 = pad + e.x;
        const lw = ptToMm(p.line.widthPt);
        const r = markerRadiusMm(p);
        const mk = markerStyle(p);
        return (
          <g key={p.id} className="legend-entry" data-plot-id={p.id} {...dbl(s, "legendEntry", p.id)}>
            {(p.type === "histogram" || p.type === "bar") && (
              <rect
                x={fmtMm(x0)}
                y={fmtMm(cy - lg.rowH * 0.3)}
                width={fmtMm(legend.symbolWidthMm)}
                height={fmtMm(lg.rowH * 0.6)}
                fill={p.type === "bar" && p.bar?.pattern && p.bar.pattern !== "none" ? `url(#${barPatternId(p.id, p.color)})` : p.color}
                stroke={p.bar?.outline ? (p.bar.outlineColor ?? "#000000") : "none"}
                strokeWidth={ptToMm(p.bar?.outlineWidthPt ?? 0.5)}
              />
            )}
            {p.showLine && p.type !== "histogram" && p.type !== "bar" && (
              <line x1={fmtMm(x0)} x2={fmtMm(x0 + legend.symbolWidthMm)} y1={fmtMm(cy)} y2={fmtMm(cy)} stroke={p.color} strokeWidth={lw} strokeDasharray={dashArray(p.line, lw)} strokeOpacity={p.line.opacity != null && p.line.opacity < 1 ? p.line.opacity : undefined} />
            )}
            {p.showMarkers && p.marker.shape !== "none" && p.type !== "histogram" && p.type !== "bar" && (
              <path d={markerPath(p.marker.shape, x0 + legend.symbolWidthMm / 2, cy, r)} fill={mk.fill} stroke={mk.stroke} strokeWidth={mk.strokeWidth} opacity={p.marker.opacity != null && p.marker.opacity < 1 ? p.marker.opacity : undefined} />
            )}
            <MarkupText text={e.text} x={x0 + legend.symbolWidthMm + 1.2} y={cy} style={style} vAnchor="middle" />
          </g>
        );
      })}
      {interactive && <rect className="hit" x={0} y={0} width={fmtMm(lg.w)} height={fmtMm(lg.h)} fill={HIT} />}
      {selected && <rect x={0} y={0} width={fmtMm(lg.w)} height={fmtMm(lg.h)} fill="none" stroke="#007aff" strokeWidth={0.25} strokeDasharray="1 0.6" pointerEvents="none" />}
    </g>
  );
});

/** Marker paths grouped by colour for colour-by-column plots. */
function groupByColor(pts: Pt[], vals: number[], mapper: (v: number) => string, mk: (cx: number, cy: number) => string): { color: string; d: string }[] {
  const groups = new Map<string, string[]>();
  pts.forEach((p, i) => {
    if (!p) return;
    const v = vals[i];
    const color = Number.isFinite(v) ? mapper(v) : "#999999";
    const arr = groups.get(color);
    if (arr) arr.push(mk(p[0], p[1]));
    else groups.set(color, [mk(p[0], p[1])]);
  });
  return [...groups.entries()].map(([color, parts]) => ({ color, d: parts.join("") }));
}

function buildDropLines(pts: Pt[], opt: { toX: boolean; toY: boolean }, ll: LayerLayout, plot: Plot): string {
  const xLine = ll.x.line;
  const yAxis = plot.yAxis === "y2" && ll.y2 ? ll.y2 : ll.y;
  const yLine = yAxis.line;
  let d = "";
  for (const p of pts) {
    if (!p) continue;
    if (opt.toX) d += `M${fmtMm(p[0])} ${fmtMm(p[1])}V${fmtMm(xLine)}`;
    if (opt.toY) d += `M${fmtMm(p[0])} ${fmtMm(p[1])}H${fmtMm(yLine)}`;
  }
  return d;
}

function dataLabelNodes(pts: Pt[], d: { x: number[]; y: number[]; labels?: (string | number | null)[] }, plot: Plot, ll: LayerLayout): React.ReactNode[] {
  const opt = plot.labels!;
  const style: TextStyle = { ...ll.layer.axes.x.tickLabelStyle, sizePt: opt.sizePt };
  const fmt = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(opt.decimals)).toString() : "");
  const nodes: React.ReactNode[] = [];
  pts.forEach((p, i) => {
    if (!p) return;
    const text = opt.source === "y" ? fmt(d.y[i]) : opt.source === "x" ? fmt(d.x[i]) : opt.source === "xy" ? `${fmt(d.x[i])}, ${fmt(d.y[i])}` : String(d.labels?.[i] ?? "");
    if (!text) return;
    const off = opt.offsetMm;
    const pos = opt.position;
    const x = pos === "left" ? p[0] - off : pos === "right" ? p[0] + off : p[0];
    const y = pos === "above" ? p[1] - off : pos === "below" ? p[1] + off : p[1];
    nodes.push(<MarkupText key={i} text={text} x={x} y={y} style={style} anchor={pos === "left" ? "end" : pos === "right" ? "start" : "middle"} vAnchor={pos === "above" ? "baseline" : pos === "below" ? "hanging" : "middle"} />);
  });
  return nodes;
}
