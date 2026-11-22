// The kinds of plot offered in the Plot Columns gallery. A kind is a plot type plus, for some, a variant of it
// (a histogram shown as a cumulative curve, a box plot drawn as a violin).

import type { Plot, PlotType } from "../model/types";

export type PlotKindGroup = "Basic" | "Distributions and groups" | "Maps and 3D";

export interface PlotKind {
  id: string;
  label: string;
  group: PlotKindGroup;
  type: PlotType;
  /** adjusts a new plot of `type` to this kind */
  apply?: (p: Plot) => void;
  /** one line under the gallery when the kind is chosen */
  hint: string;
}

export const PLOT_KIND_GROUPS: PlotKindGroup[] = ["Basic", "Distributions and groups", "Maps and 3D"];

export const PLOT_KINDS: PlotKind[] = [
  { id: "scatter", label: "Symbol", group: "Basic", type: "scatter", hint: "One symbol per row, Y against X." },
  { id: "line", label: "Line", group: "Basic", type: "line", hint: "The rows joined by a line, Y against X." },
  { id: "lineScatter", label: "Line + symbol", group: "Basic", type: "lineScatter", hint: "A line with a symbol at every row." },
  { id: "bar", label: "Bar", group: "Basic", type: "bar", hint: "Each Y column becomes a bar series; a text or X column gives the category labels." },
  { id: "histogram", label: "Histogram", group: "Distributions and groups", type: "histogram", hint: "How often the values of a column fall into each bin." },
  {
    id: "cdf",
    label: "CDF",
    group: "Distributions and groups",
    type: "histogram",
    apply: (p) => {
      if (p.histogram) Object.assign(p.histogram, { display: "cdf", normalization: "probability" });
    },
    hint: "Cumulative distribution: the fraction of a column's values up to each x, as a step curve.",
  },
  { id: "box", label: "Box", group: "Distributions and groups", type: "box", hint: "One box per column: median, quartiles and whiskers." },
  {
    id: "violin",
    label: "Violin",
    group: "Distributions and groups",
    type: "box",
    apply: (p) => {
      if (p.box) p.box.style = "violin";
    },
    hint: "One violin per column: the smoothed distribution with a slim box inside.",
  },
  {
    id: "points",
    label: "Points",
    group: "Distributions and groups",
    type: "box",
    apply: (p) => {
      if (p.box) p.box.style = "points";
    },
    hint: "Every value of each column as a point, with a line at the median.",
  },
  { id: "heatmap", label: "Heatmap", group: "Maps and 3D", type: "heatmap", hint: "A grid of values as colors." },
  { id: "contour", label: "Contour", group: "Maps and 3D", type: "contour", hint: "Lines and bands of equal value over a grid." },
  { id: "surface3d", label: "3D surface", group: "Maps and 3D", type: "surface3d", hint: "A grid of values as a surface you can turn." },
  { id: "scatter3d", label: "3D scatter", group: "Maps and 3D", type: "scatter3d", hint: "Points in space from X, Y and Z columns." },
];

export const plotKind = (id: string): PlotKind => PLOT_KINDS.find((k) => k.id === id) ?? PLOT_KINDS[0];
