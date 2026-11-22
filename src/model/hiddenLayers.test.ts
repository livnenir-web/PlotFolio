import { describe, expect, it } from "vitest";
import { defaultAnimation, newGraph, newLayer, newPlot, newProject } from "./defaults";
import { defaultLayer, setLayerShown, shownLayers, soloLayer } from "./figure";
import { layoutGraph, pageContent } from "../graph/layout";
import { buildUpUnits } from "../graph/animation";
import { curvesForAnalysis } from "../analysis/graphCurves";
import { graphToSvg } from "../export/exportGraph";
import { deserializeProject, serializeProject } from "../io/project";

/** Two stacked layers ("top", "bottom") with one line each; the canvas height follows the content. */
function setup() {
  const p = newProject("hide");
  const sh = p.sheets[0];
  sh.columns[0].values = [0, 1, 2];
  sh.columns[1].values = [0, 10, 20];
  const g = newGraph(p.defaults, "G");
  const top = g.layers[0];
  top.name = "top";
  top.axes.x.title = "Top axis";
  const bottom = newLayer(p.defaults, "bottom", { ...top.frame, yMm: top.frame.yMm + top.frame.hMm + 20 });
  bottom.axes.x.title = "Bottom axis";
  g.layers.push(bottom);
  for (const l of g.layers) l.plots.push(newPlot(p.defaults, l, { sheetId: sh.id, xColId: sh.columns[0].id, yColId: sh.columns[1].id }, `line of ${l.name}`, "line"));
  g.canvas.autoHeight = true;
  p.graphs.push(g);
  return { p, g, top, bottom };
}

describe("hidden layers", () => {
  it("are left out of the layout, the automatic height and the export, and are not counted as off the page", () => {
    const { p, g, bottom } = setup();
    const before = layoutGraph(p, g);
    setLayerShown(bottom, false);
    const g2 = { ...g }; // the layout is cached by graph identity, as after a store update
    const after = layoutGraph(p, g2);
    expect(after.layers.map((l) => l.layer.name)).toEqual(["top"]);
    expect(after.heightMm).toBeLessThan(before.heightMm);
    expect(pageContent(after).left).toBe(0);
    const svg = graphToSvg(p, g2);
    expect(svg).toContain("Top axis");
    expect(svg).not.toContain("Bottom axis");
  });

  it("keep their place and their plots, and come back as they were", () => {
    const { p, g, bottom } = setup();
    const shown = graphToSvg(p, g);
    setLayerShown(bottom, false);
    expect(g.layers.map((l) => l.name)).toEqual(["top", "bottom"]);
    expect(bottom.plots).toHaveLength(1);
    // the flag is saved with the project
    const back = deserializeProject(serializeProject(p, { openTabs: [], activeTab: null, zoom: {}, currentFolderId: null }));
    expect(back.graphs[0].layers[1].hidden).toBe(true);
    setLayerShown(bottom, true);
    expect("hidden" in bottom).toBe(false);
    expect(graphToSvg(p, { ...g })).toBe(shown);
  });

  it("are skipped by the animation steps, by commands that pick the plots themselves and as the place for new things", () => {
    const { p, g, top } = setup();
    setLayerShown(top, false);
    expect(buildUpUnits(g, defaultAnimation().buildUp).map((u) => u.label)).toEqual(["line of bottom"]);
    expect(curvesForAnalysis(p, g, []).map((c) => c.plot.name)).toEqual(["line of bottom"]);
    expect(defaultLayer(g)?.name).toBe("bottom");
    // a plot that was chosen is still read, hidden layer or not
    expect(curvesForAnalysis(p, g, [top.plots[0].id]).map((c) => c.plot.name)).toEqual(["line of top"]);
    for (const l of g.layers) setLayerShown(l, false);
    expect(defaultLayer(g)?.name).toBe("top");
    expect(layoutGraph(p, { ...g }).layers).toHaveLength(0);
  });

  it("solo shows one layer, and all of them when it is the only one shown", () => {
    const { g } = setup();
    soloLayer(g, g.layers[1].id);
    expect(shownLayers(g).map((l) => l.name)).toEqual(["bottom"]);
    soloLayer(g, g.layers[0].id);
    expect(shownLayers(g).map((l) => l.name)).toEqual(["top"]);
    soloLayer(g, g.layers[0].id);
    expect(shownLayers(g).map((l) => l.name)).toEqual(["top", "bottom"]);
  });
});
