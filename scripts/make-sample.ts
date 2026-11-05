// Builds "Sample - 3D surface.plotproj" (and a matrix CSV) with the classic "peaks" function.
// Run with: npx tsx scripts/make-sample.ts
import { writeFileSync } from "node:fs";
import { newProject, newGraph, newPlot, newColumn, make3D, defaultColorScale, uid } from "../src/model/defaults";
import { defaultMatrixSource } from "../src/graph/matrix";
import { serializeProject } from "../src/io/project";
import type { Column, Sheet } from "../src/model/types";

const peaks = (x: number, y: number) =>
  3 * (1 - x) ** 2 * Math.exp(-(x * x) - (y + 1) ** 2) - 10 * (x / 5 - x ** 3 - y ** 5) * Math.exp(-(x * x) - y * y) - (1 / 3) * Math.exp(-((x + 1) ** 2) - y * y);

const N = 41;
const xs = Array.from({ length: N }, (_, i) => Number((-3 + (6 * i) / (N - 1)).toFixed(3)));
const ys = Array.from({ length: N }, (_, j) => Number((-3 + (6 * j) / (N - 1)).toFixed(3)));

const project = newProject("Sample - 3D surface");
project.sheets = [];

// Matrix sheet: first column = Y of each row, then one column per X position (column name = X value)
const yCol = newColumn("X");
yCol.longName = "Y";
yCol.units = "";
yCol.values = ys;
const columns: Column[] = [yCol];
for (const x of xs) {
  const c = newColumn("Y");
  c.longName = String(x);
  c.values = ys.map((y) => Number(peaks(x, y).toFixed(4)));
  columns.push(c);
}
const matrix: Sheet = { id: uid(), name: "Peaks matrix", columns };
project.sheets.push(matrix);

// XYZ sheet: the same surface as a long table (for the X, Y, Z columns layout)
const xc = newColumn("X");
xc.longName = "x";
const yc = newColumn("Y");
yc.longName = "y";
const zc = newColumn("Y");
zc.longName = "z";
for (const y of ys) for (const x of xs) {
  xc.values.push(x);
  yc.values.push(y);
  zc.values.push(Number(peaks(x, y).toFixed(4)));
}
const xyz: Sheet = { id: uid(), name: "Peaks XYZ", columns: [xc, yc, zc] };
project.sheets.push(xyz);

const d = project.defaults;

// Graph 1: 3D surface
const g3 = newGraph(d, "3D surface");
const l3 = g3.layers[0];
l3.frame = { xMm: 16, yMm: 6, wMm: 60, hMm: 50 };
make3D(d, l3);
const surf = newPlot(d, l3, { sheetId: matrix.id, xColId: null, yColId: "", matrix: defaultMatrixSource(matrix) }, "peaks", "surface3d");
l3.plots.push(surf);
l3.axes.x.title = "x";
l3.axes.y.title = "y";
l3.axes.z!.title = "z = peaks(x, y)";
l3.colorScale = { ...defaultColorScale(d, l3.frame), xMm: 66, yMm: 0, lengthMm: 40, title: "z" };
l3.legend.visible = false;
g3.canvas.widthMm = 95;
project.graphs.push(g3);

// Graph 2: heatmap + contour lines of the same matrix
const g2 = newGraph(d, "Heatmap + contour");
const l2 = g2.layers[0];
const heat = newPlot(d, l2, { sheetId: matrix.id, xColId: null, yColId: "", matrix: defaultMatrixSource(matrix) }, "peaks", "heatmap");
const cont = newPlot(d, l2, { sheetId: matrix.id, xColId: null, yColId: "", matrix: defaultMatrixSource(matrix) }, "levels", "contour");
cont.contour = { levelCount: 8, levels: null, filled: false, showLines: true, showLabels: false, lineColor: "#000000" };
cont.line.widthPt = 0.5;
l2.plots.push(heat, cont);
l2.axes.x.title = "x";
l2.axes.y.title = "y";
l2.colorScale = { ...defaultColorScale(d, l2.frame), title: "z" };
l2.legend.visible = false;
project.graphs.push(g2);

// Graph 3: 3D scatter from a random subset of the XYZ points, colored by z
let seed = 42;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const keep = xc.values.map(() => rnd() < 0.15);
const g1 = newGraph(d, "3D scatter");
const ls = g1.layers[0];
ls.frame = { xMm: 16, yMm: 6, wMm: 60, hMm: 50 };
make3D(d, ls);
const sub: Sheet = {
  id: uid(),
  name: "Peaks XYZ (sparse)",
  columns: [xc, yc, zc].map((c) => {
    const n = newColumn(c.designation);
    n.longName = c.longName;
    n.values = c.values.filter((_, i) => keep[i]);
    return n;
  }),
};
project.sheets.push(sub);
const sc = newPlot(d, ls, { sheetId: sub.id, xColId: sub.columns[0].id, yColId: sub.columns[1].id, zColId: sub.columns[2].id }, "points", "scatter3d");
sc.marker.sizePt = 3;
ls.plots.push(sc);
ls.axes.x.title = "x";
ls.axes.y.title = "y";
ls.axes.z!.title = "z";
ls.colorScale = { ...defaultColorScale(d, ls.frame), xMm: 66, yMm: 0, lengthMm: 40, title: "z" };
ls.legend.visible = false;
g1.canvas.widthMm = 95;
project.graphs.push(g1);

writeFileSync("Sample - 3D surface.plotproj", serializeProject(project));

// CSV of the matrix (header row = X values, first column = Y) for testing the importer
const lines = ["Y," + xs.join(",")];
ys.forEach((y, r) => lines.push([y, ...xs.map((x) => peaks(x, y).toFixed(4))].join(",")));
writeFileSync("Sample - peaks matrix.csv", lines.join("\n") + "\n");
console.log("wrote Sample - 3D surface.plotproj and Sample - peaks matrix.csv");
