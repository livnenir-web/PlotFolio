import { memo, useMemo } from "react";
import type { BarOptions, Plot, Selection, TextStyle } from "../../model/types";
import type { LayerLayout } from "../layout";
import type { MatrixData } from "../matrix";
import type { AxisScale } from "../scales";
import { markerRadiusMm } from "../layout";
import { autoLevels, isolines } from "../contour";
import { MarkupText } from "../textMarkup";
import { fmtMm, ptToMm } from "../units";
import { isLogScale } from "../ticks";
import { markerPath } from "./GraphSvg";
import { heatmapImage } from "./heatmapRaster";

const HIT = "rgba(0,0,0,0)";

function edges(vals: number[]): [number, number][] {
  const n = vals.length;
  if (n === 1) return [[vals[0] - 0.5, vals[0] + 0.5]];
  return vals.map((v, i) => {
    const lo = i === 0 ? v - (vals[1] - v) / 2 : (vals[i - 1] + v) / 2;
    const hi = i === n - 1 ? v + (v - vals[n - 2]) / 2 : (v + vals[i + 1]) / 2;
    return [lo, hi];
  });
}

/** Cell rectangles for a matrix, colored by `color(z)`. Falls back to a raster image for large matrices. */
function cells(m: MatrixData, xs: AxisScale, ys: AxisScale, color: (z: number) => string, quantize?: (z: number) => number) {
  const xe = edges(m.x);
  const ye = edges(m.y);
  const total = m.x.length * m.y.length;
  if (total > 40000 && typeof document !== "undefined") {
    // raster fallback
    const canvas = document.createElement("canvas");
    canvas.width = m.x.length;
    canvas.height = m.y.length;
    const ctx = canvas.getContext("2d")!;
    for (let r = 0; r < m.y.length; r++)
      for (let c = 0; c < m.x.length; c++) {
        const z = m.z[r][c];
        if (!Number.isFinite(z)) continue;
        ctx.fillStyle = color(quantize ? quantize(z) : z);
        // row 0 at the bottom of the image when y increases upwards
        ctx.fillRect(c, m.y.length - 1 - r, 1, 1);
      }
    const x0 = xs.map(xe[0][0]);
    const x1 = xs.map(xe[xe.length - 1][1]);
    const y0 = ys.map(ye[0][0]);
    const y1 = ys.map(ye[ye.length - 1][1]);
    if ([x0, x1, y0, y1].some((v) => v === null)) return null;
    return (
      <image
        href={canvas.toDataURL("image/png")}
        x={fmtMm(Math.min(x0!, x1!))}
        y={fmtMm(Math.min(y0!, y1!))}
        width={fmtMm(Math.abs(x1! - x0!))}
        height={fmtMm(Math.abs(y1! - y0!))}
        preserveAspectRatio="none"
        style={{ imageRendering: "pixelated" }}
      />
    );
  }
  const rects: React.ReactNode[] = [];
  for (let r = 0; r < m.y.length; r++) {
    const y0 = ys.map(ye[r][0]);
    const y1 = ys.map(ye[r][1]);
    if (y0 === null || y1 === null) continue;
    for (let c = 0; c < m.x.length; c++) {
      const z = m.z[r][c];
      if (!Number.isFinite(z)) continue;
      const x0 = xs.map(xe[c][0]);
      const x1 = xs.map(xe[c][1]);
      if (x0 === null || x1 === null) continue;
      rects.push(
        <rect
          key={`${r}-${c}`}
          x={fmtMm(Math.min(x0, x1))}
          y={fmtMm(Math.min(y0, y1))}
          width={fmtMm(Math.abs(x1 - x0) + 0.01)}
          height={fmtMm(Math.abs(y1 - y0) + 0.01)}
          fill={color(quantize ? quantize(z) : z)}
          stroke={color(quantize ? quantize(z) : z)}
          strokeWidth={0.03}
        />,
      );
    }
  }
  return <>{rects}</>;
}

/** Flat cells, memoised on the matrix, scales and mapper so a selection change does not rebuild thousands of rects. */
const CellsG = memo(function CellsG({ m, xs, ys, mapper, quantize }: { m: MatrixData; xs: AxisScale; ys: AxisScale; mapper: (z: number) => string; quantize?: (z: number) => number }) {
  return <>{cells(m, xs, ys, mapper, quantize)}</>;
});

export function HeatmapG({ ll, plot }: { ll: LayerLayout; plot: Plot }) {
  const mapper = ll.colors.get(plot.id);
  const m = ll.matrices.get(plot.id);
  if (!mapper || !m) return null;
  const xs = ll.x.scale;
  const ys = plot.yAxis === "y2" && ll.y2 ? ll.y2.scale : ll.y.scale;
  const method = plot.colormap?.interpolation ?? "none";
  if (method !== "none") {
    const img = heatmapImage(ll, plot, mapper, method);
    if (img)
      return (
        <g className="cells smooth" data-interpolation={method}>
          <image href={img.href} x={fmtMm(img.x)} y={fmtMm(img.y)} width={fmtMm(img.width)} height={fmtMm(img.height)} preserveAspectRatio="none" />
        </g>
      );
  }
  return (
    <g className="cells" shapeRendering="crispEdges">
      <CellsG m={m} xs={xs} ys={ys} mapper={mapper} />
    </g>
  );
}

export function contourLevels(ll: LayerLayout, plot: Plot): number[] {
  const m = ll.matrices.get(plot.id);
  const c = plot.contour;
  if (!m || !c) return [];
  if (c.levels && c.levels.length) return [...c.levels].sort((a, b) => a - b);
  const mapper = ll.colors.get(plot.id);
  return autoLevels(mapper?.min ?? m.zMin, mapper?.max ?? m.zMax, c.levelCount);
}

export function ContourG({ ll, plot }: { ll: LayerLayout; plot: Plot }) {
  const m = ll.matrices.get(plot.id);
  const mapper = ll.colors.get(plot.id);
  const c = plot.contour;
  // levels and the band quantiser are stable per (layout, plot) so the memoised cells and isolines are reused
  const levels = useMemo(() => contourLevels(ll, plot), [ll, plot]);
  const bandValue = useMemo(() => {
    const min = mapper?.min ?? 0;
    const max = mapper?.max ?? 1;
    return (z: number) => {
      let i = 0;
      while (i < levels.length && z >= levels[i]) i++;
      const lo = i === 0 ? min : levels[i - 1];
      const hi = i === levels.length ? max : levels[i];
      return (lo + hi) / 2;
    };
  }, [levels, mapper]);
  if (!m || !c || !mapper) return null;
  const xs = ll.x.scale;
  const ys = plot.yAxis === "y2" && ll.y2 ? ll.y2.scale : ll.y.scale;
  const lw = ptToMm(plot.line.widthPt);
  const lines = c.showLines
    ? levels.map((lv) => {
        const polys = isolines(m.x, m.y, m.z, lv);
        const d = polys
          .map((poly) => {
            let path = "";
            let pen = false;
            for (const [px, py] of poly) {
              const sx = xs.map(px);
              const sy = ys.map(py);
              if (sx === null || sy === null) {
                pen = false;
                continue;
              }
              path += `${pen ? "L" : "M"}${fmtMm(sx)} ${fmtMm(sy)}`;
              pen = true;
            }
            return path;
          })
          .join("");
        const color = c.lineColor ?? (c.filled ? "#000000" : mapper(lv));
        const label = c.showLabels && polys[0] && polys[0].length > 2 ? polys[0][Math.floor(polys[0].length / 2)] : null;
        const lx = label ? xs.map(label[0]) : null;
        const ly = label ? ys.map(label[1]) : null;
        return (
          <g key={lv} className="level" data-level={lv}>
            <path d={d} fill="none" stroke={color} strokeWidth={lw} strokeLinejoin="round" />
            {lx !== null && ly !== null && lx !== undefined && ly !== undefined && (
              <MarkupText text={String(Number(lv.toPrecision(4)))} x={lx} y={ly} style={{ ...ll.layer.axes.x.tickLabelStyle, sizePt: 6, color }} anchor="middle" vAnchor="middle" />
            )}
          </g>
        );
      })
    : null;
  return (
    <>
      {c.filled && (
        <g className="bands" shapeRendering="crispEdges">
          <CellsG m={m} xs={xs} ys={ys} mapper={mapper} quantize={bandValue} />
        </g>
      )}
      {lines && <g className="lines">{lines}</g>}
    </>
  );
}

/** id of the hatch pattern of a bar plot in one colour (patterns live in the plot's own <defs>) */
export function barPatternId(plotId: string, color: string): string {
  return `hatch-${plotId}-${color.replace(/[^0-9a-zA-Z]/g, "")}`;
}

/** The hatch pattern: lines (or dots) in the bar colour over white, 1 mm pitch. */
function BarPattern({ id, kind, color }: { id: string; kind: NonNullable<BarOptions["pattern"]>; color: string }) {
  const sw = ptToMm(0.5);
  const S = 1; // pitch in mm
  const lines: React.ReactNode[] = [];
  const line = (key: string, x1: number, y1: number, x2: number, y2: number) => <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={sw} />;
  if (kind === "diagonal" || kind === "crosshatch") lines.push(line("d1", 0, S, S, 0), line("d2", -S / 2, S / 2, S / 2, -S / 2), line("d3", S / 2, S * 1.5, S * 1.5, S / 2));
  if (kind === "backDiagonal" || kind === "crosshatch") lines.push(line("b1", 0, 0, S, S), line("b2", -S / 2, S / 2, S / 2, S * 1.5), line("b3", S / 2, -S / 2, S * 1.5, S / 2));
  if (kind === "horizontal") lines.push(line("h", 0, S / 2, S, S / 2));
  if (kind === "vertical") lines.push(line("v", S / 2, 0, S / 2, S));
  if (kind === "dots") lines.push(<circle key="c" cx={S / 2} cy={S / 2} r={0.18} fill={color} />);
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={S} height={S}>
      <rect width={S} height={S} fill="#ffffff" />
      {lines}
    </pattern>
  );
}

export function BarG({ ll, plot, interactive }: { ll: LayerLayout; plot: Plot; interactive: boolean }) {
  const d = ll.data.get(plot.id);
  const bar = plot.bar;
  if (!d || !bar) return null;
  const k = ll.barPlots.length || 1;
  const idx = Math.max(0, ll.barPlots.findIndex((p) => p.id === plot.id));
  const horizontal = ll.horizontalBars;
  const cat = horizontal ? ll.y.scale : ll.x.scale;
  const val = horizontal ? ll.x.scale : plot.yAxis === "y2" && ll.y2 ? ll.y2.scale : ll.y.scale;
  // width, stacking and direction are layer-wide: the first bar plot decides
  const shared = ll.barPlots[0]?.bar ?? bar;
  const group = shared.width;
  const stacked = shared.stacked;
  const bw = stacked ? group : group / k;
  const base0 = val.map(isLogScale(val.scale) ? val.from : 0) ?? (horizontal ? ll.layer.frame.xMm : ll.layer.frame.yMm + ll.layer.frame.hMm);
  const rects: React.ReactNode[] = [];
  const errs: string[] = [];
  const labelNodes: React.ReactNode[] = [];
  const cap = plot.errorBars.capMm / 2;
  // colour of bar i: the plot colour, one palette colour per category, or the colour-by-column mapping
  const mapper = bar.colorMode === "column" && plot.colorBy?.colId ? ll.colors.get(plot.id) : undefined;
  const colorOf = (i: number): string => {
    if (bar.colorMode === "category") return ll.palette[i % ll.palette.length] ?? plot.color;
    if (mapper && d.colorVals) {
      const cv = d.colorVals[i];
      return Number.isFinite(cv) ? mapper(cv) : "#999999";
    }
    return plot.color;
  };
  const pattern = bar.pattern && bar.pattern !== "none" ? bar.pattern : null;
  const usedColors = new Set<string>();
  const fillOf = (c: string) => {
    usedColors.add(c);
    return pattern ? `url(#${barPatternId(plot.id, c)})` : c;
  };
  const lbl = plot.labels?.show ? plot.labels : null;
  const lblStyle: TextStyle | null = lbl ? { ...ll.layer.axes.x.tickLabelStyle, sizePt: lbl.sizePt } : null;
  const fmtLabel = (vv: number) => (Number.isFinite(vv) ? Number(vv.toFixed(lbl?.decimals ?? 2)).toString() : "");
  for (let i = 0; i < d.y.length; i++) {
    const v = d.y[i];
    if (!Number.isFinite(v)) continue;
    let base = 0;
    if (stacked) {
      for (let j = 0; j < idx; j++) {
        const other = ll.data.get(ll.barPlots[j].id)?.y[i];
        if (other !== undefined && Number.isFinite(other) && Math.sign(other) === Math.sign(v)) base += other;
      }
    }
    const c0 = i + 1 - group / 2 + (stacked ? 0 : idx * bw);
    const a = cat.map(c0);
    const b = cat.map(c0 + bw);
    const v0 = stacked ? val.map(base) : base0;
    const v1 = val.map(base + v);
    if (a === null || b === null || v0 === null || v1 === null) continue;
    const fill = fillOf(colorOf(i));
    if (horizontal) rects.push(<rect key={i} x={fmtMm(Math.min(v0, v1))} y={fmtMm(Math.min(a, b))} width={fmtMm(Math.abs(v1 - v0))} height={fmtMm(Math.abs(b - a))} fill={fill} />);
    else rects.push(<rect key={i} x={fmtMm(Math.min(a, b))} y={fmtMm(Math.min(v0, v1))} width={fmtMm(Math.abs(b - a))} height={fmtMm(Math.abs(v1 - v0))} fill={fill} />);
    if (lbl && lblStyle) {
      const text = lbl.source === "column" ? String(d.labels?.[i] ?? "") : lbl.source === "x" ? (ll.categories?.[i] ?? "") : fmtLabel(v);
      if (text) {
        // beyond the end of the bar (inside it for a "below"/"left" position), centred on the bar
        const mid = (a + b) / 2;
        const inside = lbl.position === "below" || lbl.position === "left";
        const dir = (v >= 0 ? -1 : 1) * (horizontal ? -1 : 1) * (inside ? -1 : 1);
        const off = lbl.offsetMm;
        if (horizontal) labelNodes.push(<MarkupText key={i} text={text} x={v1 - dir * off} y={mid} style={lblStyle} anchor={dir < 0 ? "end" : "start"} vAnchor="middle" />);
        else labelNodes.push(<MarkupText key={i} text={text} x={mid} y={v1 + dir * off} style={lblStyle} anchor="middle" vAnchor={dir < 0 ? "baseline" : "hanging"} />);
      }
    }
    const e = plot.errorBars.show && d.yErr ? d.yErr[i] : 0;
    if (e > 0) {
      const mid = (a + b) / 2;
      const lo = val.map(base + v - e);
      const hi = val.map(base + v + e);
      if (lo !== null && hi !== null) {
        if (horizontal) errs.push(`M${fmtMm(lo)} ${fmtMm(mid)}H${fmtMm(hi)}M${fmtMm(lo)} ${fmtMm(mid - cap)}V${fmtMm(mid + cap)}M${fmtMm(hi)} ${fmtMm(mid - cap)}V${fmtMm(mid + cap)}`);
        else errs.push(`M${fmtMm(mid)} ${fmtMm(lo)}V${fmtMm(hi)}M${fmtMm(mid - cap)} ${fmtMm(lo)}H${fmtMm(mid + cap)}M${fmtMm(mid - cap)} ${fmtMm(hi)}H${fmtMm(mid + cap)}`);
      }
    }
  }
  void interactive;
  // the legend swatch references the plot-colour pattern too
  if (pattern) usedColors.add(plot.color);
  return (
    <>
      {pattern && (
        <defs>
          {[...usedColors].map((c) => (
            <BarPattern key={c} id={barPatternId(plot.id, c)} kind={pattern} color={c} />
          ))}
        </defs>
      )}
      <g className="bars" fill={plot.color} stroke={bar.outline ? (bar.outlineColor ?? "#000000") : "none"} strokeWidth={bar.outline ? ptToMm(bar.outlineWidthPt ?? 0.5) : 0}>
        {rects}
      </g>
      {errs.length > 0 && (
        <g className="error-bars" stroke="#000000" strokeWidth={ptToMm(plot.errorBars.widthPt)} fill="none">
          <path d={errs.join("")} />
        </g>
      )}
      {labelNodes.length > 0 && <g className="data-labels">{labelNodes}</g>}
    </>
  );
}

export function BoxG({ ll, plot }: { ll: LayerLayout; plot: Plot }) {
  const st = ll.boxes.get(plot.id);
  const box = plot.box;
  if (!st || !box) return null;
  const boxPlots = ll.layer.plots.filter((p) => p.visible && p.type === "box");
  const idx = boxPlots.findIndex((p) => p.id === plot.id) + 1;
  const horizontal = ll.horizontalBars;
  const cat = horizontal ? ll.y.scale : ll.x.scale;
  const val = horizontal ? ll.x.scale : plot.yAxis === "y2" && ll.y2 ? ll.y2.scale : ll.y.scale;
  const c = cat.map(idx);
  const half = Math.abs((cat.map(idx + box.width / 2) ?? 0) - (c ?? 0));
  const q1 = val.map(st.q1);
  const q3 = val.map(st.q3);
  const med = val.map(st.median);
  const wl = val.map(st.whiskerLo);
  const wh = val.map(st.whiskerHi);
  const mean = val.map(st.mean);
  if ([c, q1, q3, med, wl, wh].some((v) => v === null)) return null;
  const lw = ptToMm(plot.line.widthPt);
  const r = markerRadiusMm(plot);
  const P = (a: number, b: number) => (horizontal ? `${fmtMm(b)} ${fmtMm(a)}` : `${fmtMm(a)} ${fmtMm(b)}`);
  const rect = horizontal
    ? { x: Math.min(q1!, q3!), y: c! - half, width: Math.abs(q3! - q1!), height: 2 * half }
    : { x: c! - half, y: Math.min(q1!, q3!), width: 2 * half, height: Math.abs(q3! - q1!) };
  const capW = half * 0.5;
  return (
    <>
      <g className="whiskers" stroke={plot.color} strokeWidth={lw} fill="none">
        <path d={`M${P(c!, q1!)}L${P(c!, wl!)}M${P(c! - capW, wl!)}L${P(c! + capW, wl!)}M${P(c!, q3!)}L${P(c!, wh!)}M${P(c! - capW, wh!)}L${P(c! + capW, wh!)}`} />
      </g>
      <g className="box" stroke={plot.color} strokeWidth={lw} fill={plot.marker.filled ? plot.color : "#ffffff"} fillOpacity={plot.marker.filled ? 0.25 : 1}>
        <rect x={fmtMm(rect.x)} y={fmtMm(rect.y)} width={fmtMm(rect.width)} height={fmtMm(rect.height)} />
        <path d={`M${P(c! - half, med!)}L${P(c! + half, med!)}`} fill="none" strokeWidth={lw * 1.5} />
      </g>
      {box.showMean && mean !== null && (
        <g className="mean" fill="none" stroke={plot.color} strokeWidth={lw}>
          <path d={markerPath("square", horizontal ? mean : c!, horizontal ? c! : mean, Math.max(r, 0.5))} />
        </g>
      )}
      {box.showOutliers && st.outliers.length > 0 && (
        <g className="outliers" fill="none" stroke={plot.color} strokeWidth={ptToMm(0.5)}>
          <path d={st.outliers.map((o) => {
            const v = val.map(o);
            return v === null ? "" : markerPath("circle", horizontal ? v : c!, horizontal ? c! : v, Math.max(r, 0.5));
          }).join("")} />
        </g>
      )}
      {box.showData && (
        <g className="data" fill={plot.color} fillOpacity={0.5} stroke="none">
          <path d={st.values.map((o, i) => {
            const v = val.map(o);
            const jitter = ((i * 7919) % 100) / 100 - 0.5;
            const cc = c! + jitter * half * 1.2;
            return v === null ? "" : markerPath("circle", horizontal ? v : cc, horizontal ? cc : v, Math.max(r * 0.8, 0.35));
          }).join("")} />
        </g>
      )}
    </>
  );
}

export const ColorScaleG = memo(function ColorScaleG({ ll, graphId, selected, interactive, pd }: { ll: LayerLayout; graphId: string; selected: boolean; interactive: boolean; pd: (s: Selection) => object }) {
  const cs = ll.colorScale;
  const opt = ll.layer.colorScale;
  if (!cs || !opt) return null;
  const s: Selection = { kind: "colorScale", graphId, layerId: ll.layer.id };
  const N = cs.mapper.discrete || 64;
  const swatches: React.ReactNode[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = i / N;
    const t1 = (i + 1) / N;
    const val = cs.mapper.log ? Math.pow(10, Math.log10(cs.mapper.min) + (Math.log10(cs.mapper.max) - Math.log10(cs.mapper.min)) * ((t0 + t1) / 2)) : cs.mapper.min + (cs.mapper.max - cs.mapper.min) * ((t0 + t1) / 2);
    swatches.push(<rect key={i} x={0} y={fmtMm(cs.h * (1 - t1))} width={fmtMm(cs.w)} height={fmtMm(cs.h / N + 0.02)} fill={cs.mapper(val)} />);
  }
  const lw = ptToMm(ll.layer.axes.x.lineWidthPt);
  const labelW = cs.ticks.reduce((m, t) => Math.max(m, t.text.length), 0) * ptToMm(opt.style.sizePt) * 0.6;
  return (
    <g className="color-scale" transform={`translate(${fmtMm(cs.x)} ${fmtMm(cs.y)})`} style={interactive ? { cursor: "move" } : undefined} {...pd(s)}>
      <g className="swatches" stroke="none">{swatches}</g>
      <rect x={0} y={0} width={fmtMm(cs.w)} height={fmtMm(cs.h)} fill="none" stroke="#000000" strokeWidth={lw} />
      <g className="ticks" stroke="#000000" strokeWidth={lw}>
        {cs.ticks.map((t) => (
          <line key={t.value} x1={fmtMm(cs.w)} x2={fmtMm(cs.w + 1)} y1={fmtMm(t.r)} y2={fmtMm(t.r)} />
        ))}
      </g>
      <g className="tick-labels">
        {cs.ticks.map((t) => (
          <MarkupText key={t.value} text={t.text} x={cs.w + 1.6} y={t.r} style={opt.style} vAnchor="middle" />
        ))}
      </g>
      {opt.title && (
        <g className="title">
          <MarkupText text={opt.title} x={cs.w + 1.6 + labelW + ptToMm(opt.style.sizePt) * 1.2} y={cs.h / 2} style={opt.style} anchor="middle" rotate={90} />
        </g>
      )}
      {interactive && <rect className="hit" x={-0.5} y={-0.5} width={fmtMm(cs.w + 2.6 + labelW)} height={fmtMm(cs.h + 1)} fill={HIT} />}
      {selected && <rect x={-0.5} y={-0.5} width={fmtMm(cs.w + 2.6 + labelW)} height={fmtMm(cs.h + 1)} fill="none" stroke="#007aff" strokeWidth={0.25} strokeDasharray="1 0.6" pointerEvents="none" />}
    </g>
  );
});
