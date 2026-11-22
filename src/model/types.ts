// Core data model. All physical sizes are millimeters (mm), fonts and line widths are points (pt).

export type CellValue = number | string | null;

export type Designation = "X" | "Y" | "yErr" | "xErr" | "label" | "none";

export interface Column {
  id: string;
  longName: string;
  units: string;
  designation: Designation;
  values: CellValue[];
  /** Formula expression (e.g. "B*2"). When set, values are derived. */
  formula?: string;
  formulaError?: string;
  widthPx?: number;
  /** free text shown in the Comments header row */
  comment?: string;
  /**
   * Set on a column that holds the points excluded from another column of the same sheet (that column's id):
   * each excluded value sits here on its own row. See src/model/exclude.ts.
   */
  excludedFrom?: string;
}

export interface Sheet {
  id: string;
  name: string;
  columns: Column[];
  folderId?: string | null;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  collapsed?: boolean;
}

export interface TextStyle {
  font: string;
  sizePt: number;
  bold: boolean;
  italic: boolean;
  color: string;
}

/** "log" is log10 (kept for older files). */
export type AxisScale = "linear" | "log" | "log2" | "ln";
export type TickDirection = "out" | "in" | "none";
/** auto; fixed decimals; scientific (m×10^e); exponent (1.5e3); engineering (SI prefixes k, M, m, µ …) */
export type NumberFormat = "auto" | "fixed" | "scientific" | "exponent" | "engineering";

/** Scale settings of the axis segment that follows a break; a missing field inherits from the axis. */
export interface SegmentScale {
  scale?: AxisScale;
  /** null = automatic major step */
  majorStep?: number | null;
  minorCount?: number | null;
}

export interface AxisBreak {
  id: string;
  /** Value range removed from the axis. */
  from: number;
  to: number;
  /** Width of the gap drawn on the axis, in mm. */
  gapMm: number;
  /** Where the gap sits along the axis, 0 = left/bottom end … 1 = right/top end; null = proportional to the value ranges. */
  position?: number | null;
  /** Scale, major step and minor ticks of the segment after the gap (the segment before uses the axis settings). */
  after?: SegmentScale;
}

export interface Axis {
  title: string;
  titleStyle: TextStyle;
  tickLabelStyle: TextStyle;
  showTitle: boolean;
  showTickLabels: boolean;
  visible: boolean;
  auto: boolean;
  from: number;
  to: number;
  scale: AxisScale;
  /** null means automatic major step */
  majorStep: number | null;
  minorCount: number;
  tickDir: TickDirection;
  majorTickMm: number;
  minorTickMm: number;
  lineWidthPt: number;
  color: string;
  numberFormat: NumberFormat;
  decimals: number;
  /** Offset of the axis title from the tick labels, in mm. */
  titleGapMm: number;
  /** Draw the mirror axis line on the opposite side (box frame). */
  mirror: boolean;
  grid: boolean;
  breaks: AxisBreak[];
  /** Y axis only: copy the styling (fonts, ticks, line) from the X axis. */
  sameAsX: boolean;
  /** Where the axis line sits: at the frame edge (default) or crossing the other axis at this value. */
  crossAt?: number | null;
  /** Text added before / after every tick label (e.g. "$", " mm"). */
  labelPrefix?: string;
  labelSuffix?: string;
  /** Tick label rotation in degrees (0 = horizontal). */
  labelRotation?: number;
  /** Major ticks by step size (default) or by a fixed number of ticks over the range. */
  majorMode?: "step" | "count";
  majorCount?: number;
  /**
   * Ticks at given values, each with an optional label of its own (markup allowed, e.g. "\pi"). With mode
   * "add" (default) they join the regular ticks; with "replace" they are the only major ticks and minor ticks are off.
   */
  customTicks?: CustomTick[];
  customTicksMode?: "add" | "replace";
  /** Draw the axis the other way round (high values at the left / bottom). */
  reversed?: boolean;
  /** Group thousands in tick labels (12,345). */
  thousands?: boolean;
  /** Gap between the tick marks and the labels, mm (default 0.8). */
  labelGapMm?: number;
  /** Show only every n-th tick label (1 = all). */
  labelEvery?: number;
}

export interface CustomTick {
  value: number;
  label?: string;
}

export type MarkerShape =
  | "circle"
  | "square"
  | "triangle"
  | "diamond"
  | "cross"
  | "plus"
  | "none";

export type LineStyle = "solid" | "dash" | "dot" | "dashdot" | "custom";

/** How consecutive points are connected. */
export type LineConnect = "straight" | "spline" | "bspline" | "stepH" | "stepV";

export interface LineOptions {
  widthPt: number;
  style: LineStyle;
  /** Custom dash pattern in pt: [dash, gap, dash, gap …]. Used when style is "custom". */
  dashPt: number[];
  connect: LineConnect;
  /** connect "spline": how far the curve bends, 0 (straight segments) … 1 (full spline, the default) */
  smoothing?: number;
  /** 0 … 1 (default 1, opaque) */
  opacity?: number;
}

export type PlotType = "scatter" | "line" | "lineScatter" | "histogram" | "fitCurve" | "heatmap" | "contour" | "bar" | "box" | "surface3d" | "scatter3d" | "function";

/** y = f(x) plotted over the axis range (or an explicit range). */
export interface FunctionOptions {
  expression: string;
  /** null = follow the x axis */
  from: number | null;
  to: number | null;
  points: number;
  error?: string;
}

export type ShapeKind = "line" | "arrow" | "rect" | "ellipse" | "image" | "polyline" | "polygon" | "freehand" | "bracket";

/** What can sit at an end of a drawn line: an arrow head, a symbol centered on the end point, or a bar across it. */
export type LineEnd = "arrow" | "circle" | "square" | "diamond" | "bar";

/** Annotation object drawn on the canvas (coordinates in canvas mm). */
export interface Shape {
  id: string;
  kind: ShapeKind;
  /** canvas mm, or axis values when coord is "data" */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  coord?: CoordMode;
  /** draw under the plots (e.g. a shaded band) instead of on top */
  behindData?: boolean;
  stroke: string;
  strokeWidthPt: number;
  dash: LineStyle;
  dashPt: number[];
  fill: string | null;
  fillOpacity: number;
  /** line, arrow, polyline, freehand: whether something is drawn at the start / at the end, and how large (mm) */
  headStart: boolean;
  headEnd: boolean;
  headSizeMm: number;
  /** what is drawn there (missing = "arrow") */
  headStartShape?: LineEnd;
  headEndShape?: LineEnd;
  /** kind "image": the picture as a data URL (stored inside the project), its pixel size and display options */
  href?: string;
  naturalW?: number;
  naturalH?: number;
  opacity?: number;
  lockAspect?: boolean;
  name?: string;
  /** kind "image": visible part of the picture as fractions of its full size (default: all of it) */
  crop?: { x: number; y: number; w: number; h: number };
  /** polyline / polygon / freehand: the vertices (same coordinate mode as the shape); x1..y2 hold their bounding box */
  points?: { x: number; y: number }[];
  /** point shapes (legacy flag): join the vertices with a smooth curve; superseded by `smoothing` */
  smooth?: boolean;
  /**
   * point shapes: how much the curve through the vertices is smoothed, 0 (straight segments) … 1 (full
   * Catmull-Rom spline). Polygons are smoothed all the way round, including the closing vertex.
   */
  smoothing?: number;
  /** rect: rounded corners */
  cornerRadiusMm?: number;
  /**
   * kind "bracket" (a significance bracket between two groups): a line from (x1, y1) to (x2, y2) with a short tick
   * of `headSizeMm` at each end, pointing toward the data, and this label centered on the other side
   * (e.g. "*", "ns", "p = 0.012"; markup allowed).
   */
  label?: string;
  labelStyle?: TextStyle;
  /**
   * kind "bracket", attached to the axes: ids of the two box-type plots it joins (the first at x1/y1, the second at
   * x2/y2). The bracket then follows them (model/brackets.ts): it stays above them when groups are hidden or
   * reordered, and is not drawn while either one is hidden.
   */
  between?: [string, string];
}

export type ColormapName =
  | "viridis"
  | "plasma"
  | "inferno"
  | "magma"
  | "cividis"
  | "turbo"
  | "gray"
  | "hot"
  | "rainbow"
  | "greens"
  | "blues"
  | "reds"
  | "oranges"
  | "purples"
  | "ylorrd"
  | "ylgnbu"
  | "bwr"
  | "coolwarm"
  | "rdbu"
  | "rdylgn"
  | "spectral"
  | "custom";

/** How a heatmap fills the space between matrix points: discrete cells, or interpolated colors. */
export type HeatmapInterpolation = "none" | "bilinear" | "bicubic";

export interface ColormapOptions {
  name: ColormapName;
  reverse: boolean;
  /** null = auto from data */
  min: number | null;
  max: number | null;
  log: boolean;
  /** Heatmaps only; missing = "none" (one flat cell per matrix point). */
  interpolation?: HeatmapInterpolation;
  /** name "custom": gradient stops (position 0–1, color), at least two */
  custom?: { t: number; color: string }[];
  /** number of discrete color bands (0 or missing = continuous) */
  discrete?: number;
}

export interface ContourOptions {
  /** number of evenly spaced levels, or explicit levels */
  levelCount: number;
  levels: number[] | null;
  filled: boolean;
  showLines: boolean;
  showLabels: boolean;
  lineColor: string | null; // null = colormap
}

export type BarPattern = "none" | "diagonal" | "backDiagonal" | "crosshatch" | "horizontal" | "vertical" | "dots";

export interface BarOptions {
  /** total width of the bar group as a fraction of the category spacing (shared by all bar plots of a layer) */
  width: number;
  /** stacking and direction are shared by all bar plots of a layer */
  stacked: boolean;
  horizontal: boolean;
  outline: boolean;
  /** outline color and width (default black, 0.5 pt) */
  outlineColor?: string;
  outlineWidthPt?: number;
  /** "plot": every bar in the plot color; "category": one palette color per category; "column": via Color by column */
  colorMode?: "plot" | "category" | "column";
  /** hatching drawn in the plot color over a white bar (for black-and-white print) */
  pattern?: BarPattern;
}

export interface BoxOptions {
  whisker: "iqr" | "minmax" | "sd";
  showMean: boolean;
  showOutliers: boolean;
  width: number;
  showData: boolean;
  /**
   * How the group is drawn (missing = "box"): a box with whiskers, a violin (the smoothed distribution, with a
   * slim box inside) or every data point with a line at the median.
   */
  style?: "box" | "violin" | "points";
}

export interface SurfaceOptions {
  fill: boolean;
  wireframe: boolean;
  /** draw every n-th grid line of the mesh */
  meshStep: number;
  shading: boolean;
}

export interface MatrixSource {
  /** "block": columns firstColId..lastColId hold Z; "xyz": three columns of points */
  mode: "block" | "xyz";
  firstColId?: string | null;
  lastColId?: string | null;
  /** block mode: column giving the Y coordinate of each row (null = row index) */
  yColId?: string | null;
  /** block mode: take X coordinates from numeric column names */
  xFromNames?: boolean;
  zColId?: string | null;
  /** xyz mode: grid resolution when the points are not on a regular grid */
  gridN?: number;
}

export interface PlotSource {
  sheetId: string;
  xColId: string | null;
  yColId: string;
  yErrColId?: string | null;
  xErrColId?: string | null;
  /** 3D scatter / xyz */
  zColId?: string | null;
  matrix?: MatrixSource;
}

export interface HistogramOptions {
  binMode: "count" | "width";
  binCount: number;
  binWidth: number;
  rangeAuto: boolean;
  from: number;
  to: number;
  normalization: "count" | "density" | "probability";
  filled: boolean;
  /**
   * "cdf": instead of bars, the empirical cumulative distribution as a step curve — the fraction of values up to x
   * (the number of values when normalization is "count"). Exact, so the bin settings do not apply. Missing = "bars".
   */
  display?: "bars" | "cdf";
}

export interface FitSpec {
  functionId: string;
  expression: string;
  paramNames: string[];
  params: number[];
  errors: number[];
  rangeFrom: number | null;
  rangeTo: number | null;
  weighted: boolean;
  frozen: boolean;
  showBand: boolean;
  /** 95 % prediction band (where new observations are expected), wider than the confidence band */
  showPredBand?: boolean;
  /** id of the plot that was fitted */
  sourcePlotId: string;
  reportSheetId?: string;
  stats?: FitStats;
  bandLower?: number[];
  bandUpper?: number[];
  predLower?: number[];
  predUpper?: number[];
  curveX?: number[];
  curveY?: number[];
}

export interface FitStats {
  n: number;
  dof: number;
  rSquared: number;
  adjRSquared: number;
  chiSquared: number;
  reducedChiSquared: number;
  covariance: number[][];
}

/** How the edges of a shaded error band are joined between points. */
export type BandConnect = "straight" | "spline" | "bspline";

export interface ErrorBarOptions {
  show: boolean;
  /** "bars": classic bars with caps (default); "band": a shaded area between y − err and y + err */
  style?: "bars" | "band";
  capMm: number;
  widthPt: number;
  /** band: edge interpolation, fill opacity (0–1), fill color (null = plot color) and whether to outline the edges */
  bandConnect?: BandConnect;
  bandOpacity?: number;
  bandColor?: string | null;
  bandOutline?: boolean;
}

export interface Plot {
  id: string;
  name: string;
  type: PlotType;
  source: PlotSource;
  color: string;
  showMarkers: boolean;
  marker: {
    shape: MarkerShape;
    sizePt: number;
    filled: boolean;
    /** null = the plot color */
    fillColor?: string | null;
    edgeColor?: string | null;
    /** outline width in pt (default: a quarter of the size, hollow symbols only) */
    edgeWidthPt?: number | null;
    /** 0 … 1 (default 1, opaque); applies to the fill and the edge */
    opacity?: number;
  };
  /** listed in the legend (default true) */
  showInLegend?: boolean;
  /**
   * Place in the legend when its order differs from the drawing order: entries are listed by rising rank, plots
   * without one after them in drawing order. Unset on every plot = the legend follows the drawing order.
   */
  legendRank?: number;
  labels?: DataLabels;
  /** thin lines from each point down to the x axis and/or across to the y axis */
  dropLines?: { toX: boolean; toY: boolean };
  /** 3D scatter: join consecutive points with a line in the plot color (a trajectory). `showLine` stays the drop lines. */
  joinPoints?: boolean;
  /** 2D scatter: color every symbol by the value of a column through the plot's colormap */
  colorBy?: { colId: string | null };
  showLine: boolean;
  line: LineOptions;
  errorBars: ErrorBarOptions;
  yAxis: "y" | "y2";
  visible: boolean;
  histogram?: HistogramOptions;
  fit?: FitSpec;
  colormap?: ColormapOptions;
  contour?: ContourOptions;
  bar?: BarOptions;
  box?: BoxOptions;
  surface?: SurfaceOptions;
  func?: FunctionOptions;
  /** id of the curve group (Graph.plotGroups) this plot belongs to */
  groupId?: string;
}

/** How the curves of a group are colored, in their order within each layer. */
export type GroupColors =
  /** the colors of a named palette (model/palettes.ts), repeating when the group is longer */
  | { type: "palette"; paletteId: string }
  /** light to dark shades of one color */
  | { type: "shades"; base: string }
  /** evenly spaced colors of a colormap */
  | { type: "colormap"; name: ColormapName };

/**
 * Curves that belong together (a series of time points, the replicates of a condition). A group can span the layers
 * of a figure: it is shown and hidden as one, selected as one for editing, and can give its curves their colors.
 */
export interface PlotGroup {
  id: string;
  name: string;
  /** missing = every curve keeps its own color */
  colors?: GroupColors;
  /** run the colors the other way round */
  reverse?: boolean;
  /** ids of the plots that were shown when the group was hidden as a whole, so that showing it brings those back */
  shownIds?: string[];
}

export interface ColorScale {
  visible: boolean;
  /** position relative to the layer frame top-left, mm */
  xMm: number;
  yMm: number;
  lengthMm: number;
  widthMm: number;
  title: string;
  style: TextStyle;
  /** distance between labeled ticks, in the units of the scale (missing or null = automatic, thinned so the labels do not overlap) */
  tickStep?: number | null;
  /** decimals of the tick labels (missing or null = the number format of the layer's x axis, as before) */
  decimals?: number | null;
}

export interface View3D {
  azimuth: number;
  elevation: number;
  /** relative box dimensions */
  boxX: number;
  boxY: number;
  boxZ: number;
  showPanes: boolean;
  showGrid: boolean;
}

export interface Legend {
  visible: boolean;
  /** Position relative to the top-left of the layer frame, in mm. */
  xMm: number;
  yMm: number;
  style: TextStyle;
  border: boolean;
  background: boolean;
  symbolWidthMm: number;
  /** entries laid out in this many columns (default 1) */
  columns?: number;
  /** inner margin in mm (default 1) */
  paddingMm?: number;
  /**
   * List every plot that is shown on the graph, whatever its own "in the legend" tick says: hiding a plot removes
   * its entry and showing it again brings the entry back.
   */
  showActive?: boolean;
}

/** Text next to every data point. */
export interface DataLabels {
  show: boolean;
  /** what to print: the y value, the x value, both, or a text column of the sheet */
  source: "y" | "x" | "xy" | "column";
  colId: string | null;
  decimals: number;
  position: "above" | "below" | "left" | "right";
  offsetMm: number;
  sizePt: number;
}

/** "mm": canvas millimeters. "data": positions are axis values of the layer and follow the axis range. */
export type CoordMode = "mm" | "data";

export interface TextItem {
  id: string;
  text: string;
  /** Position relative to the canvas, in mm (or axis units when coord is "data"). */
  xMm: number;
  yMm: number;
  coord?: CoordMode;
  style: TextStyle;
  rotation: number;
  anchor: "start" | "middle" | "end";
}

export interface LayerFrame {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

export interface Layer {
  id: string;
  name: string;
  /**
   * A hidden layer stays in the figure (and in its Layers list) but is not laid out: it is not drawn, exported,
   * clicked or animated, and an automatic canvas height does not count it. Read `shownLayers` (model/figure.ts)
   * wherever "the layers of the figure" means the ones on screen.
   */
  hidden?: boolean;
  frame: LayerFrame;
  axes: { x: Axis; y: Axis; y2?: Axis; z?: Axis };
  plots: Plot[];
  legend: Legend;
  texts: TextItem[];
  /** Index into the color cycle for the next plot. */
  nextColorIndex: number;
  colorScale?: ColorScale;
  /** Present for 3D layers. */
  view3d?: View3D;
  shapes?: Shape[];
}

export interface Canvas {
  widthMm: number;
  heightMm: number;
  autoHeight: boolean;
  background: string;
}

/** Objects that select and move as one. Members are keys like "layer:<id>", "shape:<layerId>:<id>", "text:<layerId>:<id>", "legend:<layerId>". */
export interface ObjectGroup {
  id: string;
  members: string[];
}

// ---------------------------------------------------------------- animation

export type Easing = "linear" | "inOut";

/** Draw the data progressively, with the current point marked. */
export interface RevealEffect {
  enabled: boolean;
  /** "x": every animated plot is revealed up to the same x value (time); "order": each plot point by point */
  mode: "x" | "order";
  /** x range that the animation sweeps (mode "x"); null = the full extent of the animated plots */
  from: number | null;
  to: number | null;
  /** plots that reveal; null = every plot of the figure (fits and references can be left out) */
  plotIds: string[] | null;
  /** "fixed": axes come from the full data; "follow": the x axis shows a window that ends at the current point */
  axes: "fixed" | "follow";
  /** width of the window in x units (axes "follow") */
  followWindow: number;
  marker: { show: boolean; shape: MarkerShape; sizePt: number; color: string; filled: boolean };
  /** vertical line through the current x (mode "x") */
  cursor: { show: boolean; color: string; widthPt: number; style: LineStyle };
  /** x and y of the current point as text */
  readout: { show: boolean; decimals: number; position: "marker" | "corner" };
  /** older points fade out or disappear beyond a window (x units, or points in mode "order") */
  tail: { mode: "none" | "fade" | "hide"; window: number };
}

/** Turn the 3D view while the animation plays. */
export interface RotateEffect {
  enabled: boolean;
  azimuthFrom: number;
  azimuthTo: number;
  elevationFrom: number;
  elevationTo: number;
  easing: Easing;
}

/** Plots appear one after another. */
export interface BuildUpEffect {
  enabled: boolean;
  /** plot ids in the order they appear; null = the plot order of each layer */
  order: string[] | null;
  /**
   * What appears in one step (missing = "plot"): each plot, each curve group (plots outside a group one by one) or
   * each layer with all its plots. `order` then lists "g:<groupId>" / "l:<layerId>" keys next to plot ids.
   */
  unit?: "plot" | "group" | "layer";
  transition: "cut" | "fade";
  /** share of each plot's step spent fading in (transition "fade") */
  fadeFraction: number;
}

export interface AnimationExport {
  format: "mp4" | "gif" | "png";
  widthPx: number;
  /** GIF and PNG: transparent background instead of the canvas color */
  transparent: boolean;
  quality: "normal" | "high";
}

/** An animation of a figure: one timeline, effects that can be combined. */
export interface Animation {
  enabled: boolean;
  durationS: number;
  fps: number;
  loop: boolean;
  /** seconds the last frame stays before the animation ends or loops */
  holdEndS: number;
  reveal: RevealEffect;
  rotate: RotateEffect;
  buildUp: BuildUpEffect;
  export: AnimationExport;
}

export interface Graph {
  id: string;
  name: string;
  canvas: Canvas;
  layers: Layer[];
  folderId?: string | null;
  groups?: ObjectGroup[];
  /** curve groups (see PlotGroup); plots point at them through Plot.groupId */
  plotGroups?: PlotGroup[];
  /** optional animation of the figure (see Animation) */
  animation?: Animation;
}

export interface GraphDefaults {
  canvasWidthMm: number;
  frame: LayerFrame;
  axisTitle: TextStyle;
  tickLabel: TextStyle;
  axisLineWidthPt: number;
  tickDir: TickDirection;
  majorTickMm: number;
  minorTickMm: number;
  minorCount: number;
  markerSizePt: number;
  lineWidthPt: number;
  colors: string[];
  legend: TextStyle;
  exportDpi: number;
  exportFormat: "png" | "jpeg" | "svg";
  jpegQuality: number;
}

export interface Project {
  id: string;
  name: string;
  version: number;
  sheets: Sheet[];
  graphs: Graph[];
  folders: Folder[];
  defaults: GraphDefaults;
}

export type TabRef = { kind: "sheet"; id: string } | { kind: "graph"; id: string };

/** What was on screen: saved with the project (and locally per file) so it reopens where it was left. */
export interface ProjectView {
  openTabs: TabRef[];
  activeTab: TabRef | null;
  zoom: Record<string, number>;
  currentFolderId: string | null;
}

export type Selection =
  | { kind: "none" }
  | { kind: "canvas"; graphId: string }
  | { kind: "layer"; graphId: string; layerId: string }
  | { kind: "axis"; graphId: string; layerId: string; axis: "x" | "y" | "y2" | "z" }
  | { kind: "colorScale"; graphId: string; layerId: string }
  | { kind: "shape"; graphId: string; layerId: string; shapeId: string }
  | { kind: "plot"; graphId: string; layerId: string; plotId: string }
  | { kind: "legend"; graphId: string; layerId: string }
  | { kind: "text"; graphId: string; layerId: string; textId: string }
  | { kind: "column"; sheetId: string; colId: string };
