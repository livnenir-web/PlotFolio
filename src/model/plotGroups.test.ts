import { describe, expect, it } from "vitest";
import { newGraph, newLayer, newPlot, newProject } from "./defaults";
import type { Graph, Project } from "./types";
import { createGroup, extendGroup, groupColorList, groupMembers, moveGroup, placeBlock, placeInGroup, plotBlocks, setGroupShown, shadeOf, stepPlot, tidyGroups, ungroup } from "./plotGroups";
import { useStore } from "./store";
import { buildUpUnits } from "../graph/animation";
import { defaultAnimation } from "./defaults";

/** A figure of `panels` layers, each with the line plots a, b, c and one plot "ref". */
function setup(panels = 2): { p: Project; g: Graph } {
  const p = newProject("groups");
  const sh = p.sheets[0];
  sh.columns[0].values = [0, 1, 2];
  sh.columns[1].values = [1, 2, 3];
  const g = newGraph(p.defaults, "G");
  g.layers = [];
  for (let i = 0; i < panels; i++) {
    const l = newLayer(p.defaults, `Panel ${i + 1}`, { ...p.defaults.frame, xMm: p.defaults.frame.xMm + 70 * i });
    for (const name of ["a", "b", "c", "ref"]) l.plots.push(newPlot(p.defaults, l, { sheetId: sh.id, xColId: sh.columns[0].id, yColId: sh.columns[1].id }, name, "line"));
    g.layers.push(l);
  }
  p.graphs.push(g);
  return { p, g };
}
const names = (g: Graph, i = 0) => g.layers[i].plots.map((x) => x.name).join(" ");
const ids = (g: Graph, i: number, which: string[]) => g.layers[i].plots.filter((x) => which.includes(x.name)).map((x) => x.id);

describe("curve groups", () => {
  it("gathers the curves of a group and extends it to the same names in other panels", () => {
    const { g } = setup(3);
    const id = createGroup(g, ids(g, 0, ["a", "c"]), "Series");
    expect(names(g)).toBe("a c b ref"); // the members sit together, at the place of the first
    expect(g.plotGroups).toEqual([{ id, name: "Series" }]);
    expect(extendGroup(g, id)).toBe(4);
    expect(groupMembers(g, id).map((m) => m.layer.name + m.plot.name)).toEqual(["Panel 1a", "Panel 1c", "Panel 2a", "Panel 2c", "Panel 3a", "Panel 3c"]);
    expect(names(g, 2)).toBe("a c b ref");
    expect(plotBlocks(g, g.layers[1]).map((b) => (b.group ? `[${b.plots.length}]` : b.plots[0].name))).toEqual(["[2]", "b", "ref"]);
  });

  it("colors the curves of each panel from the group, and keeps them so after any edit", () => {
    const { g } = setup(2);
    const id = createGroup(g, ids(g, 0, ["a", "b", "c"]));
    extendGroup(g, id);
    const gr = g.plotGroups![0];
    gr.colors = { type: "shades", base: "#0072B2" };
    tidyGroups(g);
    const want = [shadeOf("#0072B2", 0), shadeOf("#0072B2", 0.5), shadeOf("#0072B2", 1)];
    for (const l of g.layers) expect(l.plots.slice(0, 3).map((x) => x.color)).toEqual(want);
    expect(want[0]).not.toBe(want[2]);
    // a color set by hand does not survive, the order of the curves decides
    g.layers[0].plots[0].color = "#ff0000";
    stepPlot(g, g.layers[0], g.layers[0].plots[0].id, 1);
    tidyGroups(g);
    expect(names(g)).toBe("b a c ref");
    expect(g.layers[0].plots.slice(0, 3).map((x) => x.color)).toEqual(want);
    // palettes repeat, colormaps spread, "reverse" turns the order round
    gr.colors = { type: "palette", paletteId: "okabe" };
    expect(groupColorList(gr, 10)![8]).toBe(groupColorList(gr, 10)![0]);
    gr.colors = { type: "colormap", name: "viridis" };
    const fwd = groupColorList(gr, 4)!;
    gr.reverse = true;
    expect(groupColorList(gr, 4)).toEqual([...fwd].reverse());
    delete gr.colors;
    expect(groupColorList(gr, 4)).toBeNull();
  });

  it("moves a curve inside its group and other plots past the whole group", () => {
    const { g } = setup(1);
    const id = createGroup(g, ids(g, 0, ["a", "b"]));
    const l = g.layers[0];
    const plot = (n: string) => l.plots.find((x) => x.name === n)!.id;
    stepPlot(g, l, plot("b"), 1); // last of its group: stays
    expect(names(g)).toBe("a b c ref");
    stepPlot(g, l, plot("c"), -1);
    expect(names(g)).toBe("c a b ref");
    moveGroup(g, l.id, id, 1);
    expect(names(g)).toBe("c ref a b");
    stepPlot(g, l, plot("a"), 1);
    expect(names(g)).toBe("c ref b a");
  });

  it("drops a plot or a whole group at a place among the blocks, and a curve at a place in its group", () => {
    const { g } = setup(1);
    createGroup(g, ids(g, 0, ["a", "b", "c"]));
    const l = g.layers[0];
    // blocks: [a b c] ref
    placeBlock(g, l, 1, 0);
    expect(names(g)).toBe("ref a b c");
    placeBlock(g, l, 1, 0); // the group, back to the front
    expect(names(g)).toBe("a b c ref");
    placeInGroup(g, l, l.plots.find((x) => x.name === "a")!.id, 2);
    expect(names(g)).toBe("b c a ref");
    placeInGroup(g, l, l.plots.find((x) => x.name === "ref")!.id, 0); // not in a group: nothing
    placeBlock(g, l, 5, 0);
    expect(names(g)).toBe("b c a ref");
    expect(plotBlocks(g, l).length).toBe(2);
  });

  it("hides a group and brings back the curves that were shown", () => {
    const { g } = setup(2);
    const id = createGroup(g, ids(g, 0, ["a", "b", "c"]));
    extendGroup(g, id);
    g.layers[0].plots[1].visible = false;
    const shown = () => g.layers.map((l) => l.plots.map((x) => (x.visible ? 1 : 0)).join("")).join(" ");
    expect(shown()).toBe("1011 1111");
    setGroupShown(g, id, false);
    expect(shown()).toBe("0001 0001");
    setGroupShown(g, id, true);
    expect(shown()).toBe("1011 1111");
    expect(g.plotGroups![0].shownIds).toBeUndefined();
  });

  it("drops groups without curves and curves of unknown groups", () => {
    const { g } = setup(1);
    const id = createGroup(g, ids(g, 0, ["a", "b"]));
    g.layers[0].plots[3].groupId = "gone";
    g.layers[0].plots = g.layers[0].plots.filter((x) => x.groupId !== id);
    tidyGroups(g);
    expect(g.plotGroups).toBeUndefined();
    expect(g.layers[0].plots.every((x) => !x.groupId)).toBe(true);
    const id2 = createGroup(g, g.layers[0].plots.map((x) => x.id));
    ungroup(g, id2);
    expect(g.plotGroups).toBeUndefined();
  });

  it("steps the build-up by plot, by group or by panel", () => {
    const { g } = setup(2);
    const id = createGroup(g, ids(g, 0, ["a", "b"]), "Series");
    extendGroup(g, id);
    const b = defaultAnimation().buildUp;
    expect(buildUpUnits(g, b)).toHaveLength(8);
    const byGroup = buildUpUnits(g, { ...b, unit: "group" });
    expect(byGroup.map((u) => `${u.label}:${u.plotIds.length}`)).toEqual(["Series:4", "c:1", "ref:1", "c:1", "ref:1"]);
    const byLayer = buildUpUnits(g, { ...b, unit: "layer", order: [`l:${g.layers[1].id}`, "unknown"] });
    expect(byLayer.map((u) => `${u.label}:${u.plotIds.length}`)).toEqual(["Panel 2:4", "Panel 1:4"]);
    g.layers[0].plots.forEach((x) => (x.visible = false));
    expect(buildUpUnits(g, { ...b, unit: "layer" }).map((u) => u.label)).toEqual(["Panel 2"]);
  });
});

describe("copy to new figure", () => {
  it("copies a panel with its texts and groups to the corner of a fitting canvas", () => {
    const { p, g } = setup(3);
    const gid = createGroup(g, ids(g, 0, ["a", "b", "c"]), "Series");
    extendGroup(g, gid);
    g.plotGroups![0].colors = { type: "colormap", name: "viridis" };
    tidyGroups(g);
    const src = g.layers[2];
    src.texts.push({ id: "t", text: "Title", xMm: src.frame.xMm + 10, yMm: src.frame.yMm - 2, style: { ...p.defaults.tickLabel }, rotation: 0, anchor: "middle" });
    useStore.getState().resetProject(p);
    const before = JSON.stringify(useStore.getState().project.graphs[0]);
    const id = useStore.getState().copyToNewGraph(g.id, [src.id]);
    const state = useStore.getState();
    const made = state.project.graphs.find((x) => x.id === id)!;
    expect(JSON.stringify(state.project.graphs[0])).toBe(before); // the source is untouched
    expect(made.name).toBe("G – Panel 3");
    expect(state.ui.activeTab).toEqual({ kind: "graph", id });
    expect(made.layers).toHaveLength(1);
    const l = made.layers[0];
    expect(l.id).not.toBe(src.id);
    expect(l.frame.xMm).toBeLessThan(src.frame.xMm - 100);
    // the title keeps its place relative to the frame
    expect(l.texts[0].xMm - l.frame.xMm).toBeCloseTo(10, 9);
    expect(l.texts[0].yMm - l.frame.yMm).toBeCloseTo(-2, 9);
    expect(made.canvas.widthMm).toBeLessThan(g.canvas.widthMm);
    expect(made.canvas.widthMm).toBeGreaterThan(l.frame.xMm + l.frame.wMm);
    expect(made.plotGroups).toEqual([{ id: gid, name: "Series", colors: { type: "colormap", name: "viridis" } }]);
    expect(l.plots.map((x) => x.color)).toEqual(src.plots.map((x) => x.color));
    expect(l.plots.every((x) => !src.plots.some((y) => y.id === x.id))).toBe(true);
  });

  it("copies single curves with the colors they have", () => {
    const { p, g } = setup(1);
    const gid = createGroup(g, ids(g, 0, ["a", "b", "c"]));
    g.plotGroups![0].colors = { type: "colormap", name: "viridis" };
    tidyGroups(g);
    useStore.getState().resetProject(p);
    const l0 = g.layers[0];
    const id = useStore.getState().copyToNewGraph(g.id, [l0.id], [l0.plots[2].id]);
    const made = useStore.getState().project.graphs.find((x) => x.id === id)!;
    expect(made.name).toBe("G copy");
    expect(made.layers[0].plots.map((x) => [x.name, x.color])).toEqual([["c", l0.plots[2].color]]);
    expect(made.plotGroups).toEqual([{ id: gid, name: "Group 1" }]);
  });
});
