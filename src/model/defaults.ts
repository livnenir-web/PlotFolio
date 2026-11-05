import { nanoid } from "nanoid";
import type {
  Axis,
  Canvas,
  Column,
  Designation,
  Graph,
  GraphDefaults,
  Layer,
  LayerFrame,
  Legend,
  Plot,
  PlotSource,
  PlotType,
  Project,
  Sheet,
  TextStyle,
} from "./types";

export const uid = () => nanoid(10);

/** Okabe-Ito colorblind-safe palette, in cycle order. */
export const OKABE_ITO = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#D55E00",
  "#CC79A7",
  "#56B4E9",
  "#F0E442",
  "#000000",
];

export const DEFAULT_FONT = "Arial";

export const PROJECT_VERSION = 1;

export function defaultGraphDefaults(): GraphDefaults {
  return {
    canvasWidthMm: 87,
    frame: { xMm: 20, yMm: 5, wMm: 50, hMm: 50 },
    axisTitle: { font: DEFAULT_FONT, sizePt: 9, bold: false, italic: false, color: "#000000" },
    tickLabel: { font: DEFAULT_FONT, sizePt: 8, bold: false, italic: false, color: "#000000" },
    axisLineWidthPt: 0.5,
    tickDir: "out",
    majorTickMm: 1.2,
    minorTickMm: 0.6,
    minorCount: 1,
    markerSizePt: 2,
    lineWidthPt: 1,
    colors: [...OKABE_ITO],
    legend: { font: DEFAULT_FONT, sizePt: 8, bold: false, italic: false, color: "#000000" },
    exportDpi: 300,
    exportFormat: "png",
    jpegQuality: 0.92,
  };
}

export function cloneStyle(s: TextStyle): TextStyle {
  return { ...s };
}

export function newAxis(d: GraphDefaults, which: "x" | "y" | "y2", title = ""): Axis {
  return {
    title,
    titleStyle: cloneStyle(d.axisTitle),
    tickLabelStyle: cloneStyle(d.tickLabel),
    showTitle: true,
    showTickLabels: true,
    visible: true,
    auto: true,
    from: 0,
    to: 10,
    scale: "linear",
    majorStep: null,
    minorCount: d.minorCount,
    tickDir: d.tickDir,
    majorTickMm: d.majorTickMm,
    minorTickMm: d.minorTickMm,
    lineWidthPt: d.axisLineWidthPt,
    color: "#000000",
    numberFormat: "auto",
    decimals: 2,
    titleGapMm: 1.5,
    mirror: false,
    grid: false,
    breaks: [],
    sameAsX: which !== "x",
  };
}

export function newLegend(d: GraphDefaults, frame: LayerFrame): Legend {
  return {
    visible: true,
    xMm: frame.wMm - 18,
    yMm: 1.5,
    style: cloneStyle(d.legend),
    border: false,
    background: false,
    symbolWidthMm: 5,
  };
}

export function newLayer(d: GraphDefaults, name = "Layer 1", frame?: LayerFrame): Layer {
  const f = frame ?? { ...d.frame };
  return {
    id: uid(),
    name,
    frame: f,
    axes: { x: newAxis(d, "x", "X axis title"), y: newAxis(d, "y", "Y axis title") },
    plots: [],
    legend: newLegend(d, f),
    texts: [],
    nextColorIndex: 0,
  };
}

export function newCanvas(d: GraphDefaults): Canvas {
  return { widthMm: d.canvasWidthMm, heightMm: 62, autoHeight: true, background: "#ffffff" };
}

export function newGraph(d: GraphDefaults, name = "Graph 1"): Graph {
  return { id: uid(), name, canvas: newCanvas(d), layers: [newLayer(d)] };
}

export function defaultColormap(): import("./types").ColormapOptions {
  return { name: "viridis", reverse: false, min: null, max: null, log: false, interpolation: "none" };
}
export function defaultContour(): import("./types").ContourOptions {
  return { levelCount: 10, levels: null, filled: true, showLines: true, showLabels: false, lineColor: null };
}
export function defaultBar(): import("./types").BarOptions {
  return { width: 0.7, stacked: false, horizontal: false, outline: false };
}
export function defaultBox(): import("./types").BoxOptions {
  return { whisker: "iqr", showMean: true, showOutliers: true, width: 0.5, showData: false };
}
export function defaultSurface(): import("./types").SurfaceOptions {
  return { fill: true, wireframe: true, meshStep: 1, shading: true };
}
export function defaultColorScale(d: GraphDefaults, frame: LayerFrame): import("./types").ColorScale {
  return { visible: true, xMm: frame.wMm + 3, yMm: 0, lengthMm: frame.hMm, widthMm: 3, title: "", style: cloneStyle(d.tickLabel) };
}
export function defaultView3D(): import("./types").View3D {
  return { azimuth: 35, elevation: 25, boxX: 1, boxY: 1, boxZ: 0.75, showPanes: true, showGrid: true };
}

export function newShape(kind: import("./types").ShapeKind, x1: number, y1: number, x2: number, y2: number): import("./types").Shape {
  return {
    id: uid(),
    kind,
    x1,
    y1,
    x2,
    y2,
    stroke: "#000000",
    strokeWidthPt: kind === "image" ? 0 : 0.75,
    dash: "solid",
    dashPt: [4, 2],
    fill: null,
    fillOpacity: 0.3,
    headStart: false,
    headEnd: kind === "arrow",
    headSizeMm: 2,
    ...(kind === "image" ? { opacity: 1, lockAspect: true } : {}),
    ...(kind === "freehand" ? { smooth: true } : {}),
  };
}

export function newPlot(
  d: GraphDefaults,
  layer: Layer,
  source: PlotSource,
  name: string,
  type: PlotType = "scatter",
): Plot {
  const color = d.colors[layer.nextColorIndex % d.colors.length];
  return {
    id: uid(),
    name,
    type,
    source,
    color,
    showMarkers: type === "scatter" || type === "lineScatter",
    func: type === "function" ? { expression: "sin(x)", from: null, to: null, points: 400 } : undefined,
    marker: { shape: "circle", sizePt: d.markerSizePt, filled: true },
    showLine: type === "line" || type === "lineScatter" || type === "fitCurve" || type === "function",
    line: { widthPt: type === "contour" ? 0.5 : d.lineWidthPt, style: "solid", dashPt: [4, 2], connect: "straight" },
    errorBars: { capMm: 0.8, widthPt: 0.5, show: true },
    yAxis: "y",
    visible: true,
    histogram: type === "histogram" ? { binMode: "count", binCount: 10, binWidth: 1, rangeAuto: true, from: 0, to: 1, normalization: "count", filled: true } : undefined,
    colormap: type === "heatmap" || type === "contour" || type === "surface3d" || type === "scatter3d" ? defaultColormap() : undefined,
    contour: type === "contour" ? defaultContour() : undefined,
    bar: type === "bar" ? defaultBar() : undefined,
    box: type === "box" ? defaultBox() : undefined,
    surface: type === "surface3d" ? defaultSurface() : undefined,
  };
}

/** Marks a layer as 3D (adds a z axis and view angles). */
export function make3D(d: GraphDefaults, layer: Layer): void {
  if (layer.view3d) return;
  layer.view3d = defaultView3D();
  layer.axes.z = newAxis(d, "y", "Z axis title");
  layer.axes.z.sameAsX = true;
}

export function newColumn(designation: Designation = "Y", rows = 0): Column {
  return {
    id: uid(),
    longName: "",
    units: "",
    designation,
    values: new Array(rows).fill(null),
  };
}

export function newSheet(name = "Sheet 1"): Sheet {
  return {
    id: uid(),
    name,
    columns: [newColumn("X"), newColumn("Y")],
  };
}

export function newProject(name = "Untitled"): Project {
  return {
    id: uid(),
    name,
    version: PROJECT_VERSION,
    sheets: [newSheet()],
    graphs: [],
    folders: [],
    defaults: defaultGraphDefaults(),
  };
}

/** Column letter for a zero-based index: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let s = "";
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Inverse of columnLetter; returns -1 when the string is not a column letter. */
export function letterIndex(letter: string): number {
  if (!/^[A-Z]+$/.test(letter)) return -1;
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  const m = base.match(/^(.*?)(\d+)$/);
  const stem = m ? m[1] : base + " ";
  let n = m ? parseInt(m[2], 10) + 1 : 2;
  while (existing.includes(`${stem}${n}`)) n++;
  return `${stem}${n}`;
}
