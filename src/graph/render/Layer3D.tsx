import type { Plot, Selection } from "../../model/types";
import type { LayerLayout } from "../layout";
import { effectiveAxis, markerRadiusMm } from "../layout";
import { frontEdges, mixColor } from "../projection3d";
import { formatTick } from "../ticks";
import { MarkupText } from "../textMarkup";
import { fmtMm, ptToMm } from "../units";
import { markerPath } from "./GraphSvg";

const HIT = "rgba(0,0,0,0)";

interface Unit {
  x: (v: number) => number | null;
  y: (v: number) => number | null;
  z: (v: number) => number | null;
}

/** 3D layer: axes box, panes, surface/scatter content, projected to the frame. */
export function Layer3DG({ ll, graphId, sel, interactive, pd, dbl }: { ll: LayerLayout; graphId: string; sel?: Selection[]; interactive: boolean; pd: (s: Selection) => object; dbl: (s: Selection, target?: "title" | "legendEntry" | "text", extra?: string) => object }) {
  const { layer, projector: P, zScale } = ll;
  const view = layer.view3d;
  if (!P || !zScale || !view) return null;
  const f = layer.frame;
  const unit: Unit = {
    x: (v) => {
      const r = ll.x.scale.map(v);
      return r === null ? null : (r - f.xMm) / f.wMm;
    },
    y: (v) => {
      const r = ll.y.scale.map(v);
      return r === null ? null : (f.yMm + f.hMm - r) / f.hMm;
    },
    z: (v) => zScale.map(v),
  };
  const edgesF = frontEdges(view, P.project);
  const axX = effectiveAxis(layer, "x");
  const axY = effectiveAxis(layer, "y");
  const axZ = effectiveAxis(layer, "z");
  const lw = ptToMm(axX.lineWidthPt);
  const farU = edgesF.front.u === 1 ? 0 : 1; // wall at the far side in u
  const farV = edgesF.front.v === 1 ? 0 : 1;
  const bottomW = edgesF.xEdge.w;

  const pt = (u: number, v: number, w: number) => {
    const [x, y] = P.project(u, v, w);
    return `${fmtMm(x)} ${fmtMm(y)}`;
  };

  // ---- panes with grid lines
  const panes: React.ReactNode[] = [];
  if (view.showPanes) {
    const paneFill = "#f3f3f3";
    const grid = "#ffffff";
    // bottom pane (w = bottomW)
    panes.push(<path key="pb" d={`M${pt(0, 0, bottomW)}L${pt(1, 0, bottomW)}L${pt(1, 1, bottomW)}L${pt(0, 1, bottomW)}Z`} fill={paneFill} />);
    // far wall in u (u = farU): spans v, w
    panes.push(<path key="pu" d={`M${pt(farU, 0, 0)}L${pt(farU, 1, 0)}L${pt(farU, 1, 1)}L${pt(farU, 0, 1)}Z`} fill={paneFill} />);
    // far wall in v (v = farV): spans u, w
    panes.push(<path key="pv" d={`M${pt(0, farV, 0)}L${pt(1, farV, 0)}L${pt(1, farV, 1)}L${pt(0, farV, 1)}Z`} fill={paneFill} />);
    if (view.showGrid) {
      const lines: string[] = [];
      for (const v of ll.x.scale.major) {
        const u = unit.x(v);
        if (u === null) continue;
        lines.push(`M${pt(u, 0, bottomW)}L${pt(u, 1, bottomW)}`, `M${pt(u, farV, 0)}L${pt(u, farV, 1)}`);
      }
      for (const v of ll.y.scale.major) {
        const vv = unit.y(v);
        if (vv === null) continue;
        lines.push(`M${pt(0, vv, bottomW)}L${pt(1, vv, bottomW)}`, `M${pt(farU, vv, 0)}L${pt(farU, vv, 1)}`);
      }
      for (const v of zScale.major) {
        const w = unit.z(v);
        if (w === null) continue;
        lines.push(`M${pt(farU, 0, w)}L${pt(farU, 1, w)}`, `M${pt(0, farV, w)}L${pt(1, farV, w)}`);
      }
      panes.push(<path key="grid" d={lines.join("")} fill="none" stroke={grid} strokeWidth={lw} />);
    }
  }

  // ---- content: collect depth-sorted primitives
  const prims: { depth: number; node: React.ReactNode }[] = [];
  for (const plot of layer.plots) {
    if (!plot.visible) continue;
    if (plot.type === "surface3d") collectSurface(ll, plot, unit, prims);
    else if (plot.type === "scatter3d") collectScatter(ll, plot, unit, prims);
  }
  prims.sort((a, b) => b.depth - a.depth);

  // ---- axes along front edges
  const center = P.project(0.5, 0.5, 0.5);
  const axisNode = (
    which: "x" | "y" | "z",
    axis: typeof axX,
    scale: typeof ll.x.scale,
    toUnit: (v: number) => number | null,
    p0: (t: number) => [number, number, number],
  ) => {
    const start = P.project(...p0(0));
    const end = P.project(...p0(1));
    const mid = P.project(...p0(0.5));
    // outward direction in screen space, away from the box center
    let ox = mid[0] - center[0];
    let oy = mid[1] - center[1];
    // make it perpendicular to the axis direction
    const ax = end[0] - start[0];
    const ay = end[1] - start[1];
    const al = Math.hypot(ax, ay) || 1;
    const dot = (ox * ax + oy * ay) / (al * al);
    ox -= dot * ax;
    oy -= dot * ay;
    const ol = Math.hypot(ox, oy) || 1;
    ox /= ol;
    oy /= ol;
    const tick = axis.tickDir === "none" ? 0 : axis.majorTickMm;
    const ticks: React.ReactNode[] = [];
    const labels: React.ReactNode[] = [];
    const labelGap = tick + 1;
    const anchor: "start" | "middle" | "end" = Math.abs(ox) < 0.3 ? "middle" : ox > 0 ? "start" : "end";
    for (const v of scale.major) {
      const t = toUnit(v);
      if (t === null) continue;
      const [x, y] = P.project(...p0(t));
      ticks.push(<line key={v} x1={fmtMm(x)} y1={fmtMm(y)} x2={fmtMm(x + ox * tick)} y2={fmtMm(y + oy * tick)} />);
      labels.push(<MarkupText key={v} text={scale.categories ? scale.categories[scale.major.indexOf(v)] ?? "" : formatTick(v, axis, scale.step)} x={x + ox * labelGap} y={y + oy * labelGap} style={axis.tickLabelStyle} anchor={anchor} vAnchor="middle" />);
    }
    const titleGap = labelGap + ptToMm(axis.tickLabelStyle.sizePt) * 2.2 + axis.titleGapMm;
    const titleAngle = which === "z" ? -90 : (Math.atan2(ay, ax) * 180) / Math.PI;
    const s: Selection = { kind: "axis", graphId, layerId: layer.id, axis: which };
    return (
      <g className={`axis axis-${which}`} key={which}>
        <g className="axis-line" stroke={axis.color} strokeWidth={lw} fill="none">
          <line x1={fmtMm(start[0])} y1={fmtMm(start[1])} x2={fmtMm(end[0])} y2={fmtMm(end[1])} />
        </g>
        <g className="ticks major" stroke={axis.color} strokeWidth={lw}>
          {ticks}
        </g>
        <g className="tick-labels">{labels}</g>
        {axis.showTitle && axis.title && (
          <g className="axis-title">
            <MarkupText text={axis.title} x={mid[0] + ox * titleGap} y={mid[1] + oy * titleGap} style={axis.titleStyle} anchor="middle" vAnchor="middle" rotate={titleAngle > 90 || titleAngle < -90 ? titleAngle + 180 : titleAngle} />
          </g>
        )}
        {interactive && (
          <line className="hit" x1={fmtMm(start[0])} y1={fmtMm(start[1])} x2={fmtMm(end[0])} y2={fmtMm(end[1])} stroke={HIT} strokeWidth={3} {...pd(s)} {...dbl(s, "title")} />
        )}
      </g>
    );
  };

  const axes = (
    <>
      {axisNode("x", axX, ll.x.scale, unit.x, (t) => [t, edgesF.xEdge.v, edgesF.xEdge.w])}
      {axisNode("y", axY, ll.y.scale, unit.y, (t) => [edgesF.yEdge.u, t, edgesF.yEdge.w])}
      {axisNode("z", axZ, zScale, unit.z, (t) => [edgesF.zEdge.u, edgesF.zEdge.v, t])}
    </>
  );

  const layerSel: Selection = { kind: "layer", graphId, layerId: layer.id };
  const selected = !!sel && sel.some((x) => x.kind === "layer" && x.layerId === layer.id);
  return (
    <>
      <g className="panes">{panes}</g>
      <g className="plots">{prims.map((p, i) => <g key={i}>{p.node}</g>)}</g>
      <g className="box-edges" stroke="#000000" strokeWidth={lw * 0.6} fill="none" opacity={0.6}>
        <path d={`M${pt(0, 0, bottomW)}L${pt(1, 0, bottomW)}L${pt(1, 1, bottomW)}L${pt(0, 1, bottomW)}Z M${pt(farU, 0, 0)}L${pt(farU, 1, 0)}L${pt(farU, 1, 1)}L${pt(farU, 0, 1)}Z M${pt(0, farV, 0)}L${pt(1, farV, 0)}L${pt(1, farV, 1)}L${pt(0, farV, 1)}Z`} />
      </g>
      {axes}
      {interactive && <rect className="hit layer-hit" x={f.xMm} y={f.yMm} width={f.wMm} height={f.hMm} fill={HIT} style={{ cursor: "move" }} {...pd(layerSel)} {...dbl(layerSel)} />}
      {selected && null}
    </>
  );
}

function collectSurface(ll: LayerLayout, plot: Plot, unit: Unit, out: { depth: number; node: React.ReactNode }[]) {
  const m = ll.matrices.get(plot.id);
  const P = ll.projector!;
  const opt = plot.surface;
  const mapper = ll.colors.get(plot.id);
  if (!m || !opt) return;
  const nx = m.x.length;
  const ny = m.y.length;
  const U = m.x.map((v) => unit.x(v));
  const V = m.y.map((v) => unit.y(v));
  const W = m.z.map((row) => row.map((v) => unit.z(v)));
  const lw = ptToMm(plot.line.widthPt) * 0.5;
  const step = Math.max(1, Math.round(opt.meshStep));
  for (let r = 0; r < ny - 1; r++) {
    for (let c = 0; c < nx - 1; c++) {
      const corners = [
        [U[c], V[r], W[r][c]],
        [U[c + 1], V[r], W[r][c + 1]],
        [U[c + 1], V[r + 1], W[r + 1][c + 1]],
        [U[c], V[r + 1], W[r + 1][c]],
      ];
      if (corners.some((k) => k.some((v) => v === null))) continue;
      const pts = corners.map((k) => P.project(k[0]!, k[1]!, k[2]!));
      const depth = pts.reduce((s, p) => s + p[2], 0) / 4;
      const zMean = (m.z[r][c] + m.z[r][c + 1] + m.z[r + 1][c + 1] + m.z[r + 1][c]) / 4;
      let fill = mapper ? mapper(zMean) : plot.color;
      if (opt.shading) {
        // normal from the two diagonals in unit space (z exaggerated by the box ratio)
        const a = corners[0] as number[];
        const b = corners[1] as number[];
        const d = corners[3] as number[];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        fill = mixColor(fill, P.shade(n[0], n[1], n[2]));
      }
      const d = `M${fmtMm(pts[0][0])} ${fmtMm(pts[0][1])}L${fmtMm(pts[1][0])} ${fmtMm(pts[1][1])}L${fmtMm(pts[2][0])} ${fmtMm(pts[2][1])}L${fmtMm(pts[3][0])} ${fmtMm(pts[3][1])}Z`;
      const mesh = opt.wireframe && (r % step === 0 || c % step === 0 || r === ny - 2 || c === nx - 2);
      out.push({
        depth,
        node: <path d={d} fill={opt.fill ? fill : "none"} stroke={mesh ? (opt.fill ? "#000000" : fill) : opt.fill ? fill : "none"} strokeOpacity={mesh && opt.fill ? 0.35 : 1} strokeWidth={mesh ? Math.max(lw, 0.08) : 0.05} strokeLinejoin="round" />,
      });
    }
  }
}

function collectScatter(ll: LayerLayout, plot: Plot, unit: Unit, out: { depth: number; node: React.ReactNode }[]) {
  const d = ll.data.get(plot.id) as ({ x: number[]; y: number[]; z?: number[] }) | undefined;
  const P = ll.projector!;
  if (!d || !d.z) return;
  const mapper = ll.colors.get(plot.id);
  const r = markerRadiusMm(plot);
  const hollow = !plot.marker.filled;
  for (let i = 0; i < d.x.length; i++) {
    const u = unit.x(d.x[i]);
    const v = unit.y(d.y[i]);
    const w = unit.z(d.z[i]);
    if (u === null || v === null || w === null) continue;
    const [x, y, depth] = P.project(u, v, w);
    const color = mapper ? mapper(d.z[i]) : plot.color;
    out.push({ depth, node: <path d={markerPath(plot.marker.shape, x, y, r)} fill={hollow ? "none" : color} stroke={hollow ? color : "none"} strokeWidth={hollow ? ptToMm(0.5) : 0} /> });
  }
  // drop lines to the floor
  if (plot.showLine) {
    for (let i = 0; i < d.x.length; i++) {
      const u = unit.x(d.x[i]);
      const v = unit.y(d.y[i]);
      const w = unit.z(d.z[i]);
      if (u === null || v === null || w === null) continue;
      const [x1, y1, depth] = P.project(u, v, w);
      const [x0, y0] = P.project(u, v, 0);
      out.push({ depth: depth + 1e-6, node: <line x1={fmtMm(x0)} y1={fmtMm(y0)} x2={fmtMm(x1)} y2={fmtMm(y1)} stroke={plot.color} strokeWidth={ptToMm(plot.line.widthPt) * 0.5} strokeOpacity={0.6} /> });
    }
  }
}
