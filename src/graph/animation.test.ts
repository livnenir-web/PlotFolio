import { describe, expect, it } from "vitest";
import { defaultAnimation, make3D, newGraph, newPlot, newProject } from "../model/defaults";
import type { Animation, Graph, Project } from "../model/types";
import { animationFrame, ease, frameSchedule, playbackFrame, revealRange } from "./animation";
import { layoutGraph } from "./layout";

/** A project with one graph: a line y = 10·x over x = 0, 1, 2 and a second line over the same x. */
function setup(xs = [0, 1, 2], ys = [0, 10, 20]): { p: Project; g: Graph } {
  const p = newProject("anim");
  const sh = p.sheets[0];
  sh.columns[0].values = xs;
  sh.columns[1].values = ys;
  sh.columns.push({ id: "c3", longName: "", units: "", designation: "Y", values: ys.map((v) => v / 2) });
  const g = newGraph(p.defaults, "G");
  const l = g.layers[0];
  l.plots.push(newPlot(p.defaults, l, { sheetId: sh.id, xColId: sh.columns[0].id, yColId: sh.columns[1].id }, "a", "line"));
  l.plots.push(newPlot(p.defaults, l, { sheetId: sh.id, xColId: sh.columns[0].id, yColId: "c3" }, "b", "line"));
  p.graphs.push(g);
  return { p, g };
}

const anim = (over: (a: Animation) => void = () => {}): Animation => {
  const a = defaultAnimation();
  over(a);
  return a;
};

describe("animation frames", () => {
  it("returns the layout itself when nothing is animated", () => {
    const { p, g } = setup();
    const layout = layoutGraph(p, g);
    expect(animationFrame(layout, undefined, 0.5)).toBe(layout);
    expect(animationFrame(layout, anim((a) => void (a.enabled = false)), 0.5)).toBe(layout);
    expect(animationFrame(layout, anim((a) => void (a.reveal.enabled = false)), 0.5)).toBe(layout);
  });

  it("reveals along x up to an interpolated point and marks it", () => {
    const { p, g } = setup();
    const layout = layoutGraph(p, g);
    const ll = layout.layers[0];
    const [a, b] = g.layers[0].plots;
    const fr = animationFrame(layout, anim((x) => void (x.reveal.cursor.show = true)), 0.25).layers[0];
    expect(fr).not.toBe(ll);
    expect(fr.y).toBe(ll.y); // axes are those of the full data
    expect(fr.x).toBe(ll.x);
    const d = fr.data.get(a.id)!;
    expect(d.x).toEqual([0, 0.5]);
    expect(d.y[1]).toBeCloseTo(5, 9);
    expect(fr.anim!.partial.get(a.id)).toEqual({ head: false, tail: true });
    const m = fr.anim!.markers.find((k) => k.plotId === a.id)!;
    expect(m.x).toBe(0.5);
    expect(m.y).toBeCloseTo(5, 9);
    expect(m.xMm).toBeCloseTo(ll.x.scale.map(0.5)!, 9);
    expect(fr.anim!.cursorXMm).toBeCloseTo(ll.x.scale.map(0.5)!, 9);
    expect(fr.anim!.markers.find((k) => k.plotId === b.id)!.y).toBeCloseTo(2.5, 9);
    // the full data at the end, the symbol on the last point
    const end = animationFrame(layout, anim(), 1).layers[0];
    expect(end.data.get(a.id)).toBe(ll.data.get(a.id));
    expect(end.anim!.partial.size).toBe(0);
    expect(end.anim!.markers[0]).toMatchObject({ x: 2, y: 20 });
    // exactly on a sample: no interpolated point
    const mid = animationFrame(layout, anim(), 0.5).layers[0];
    expect(mid.data.get(a.id)!.x).toEqual([0, 1]);
    expect(mid.anim!.partial.size).toBe(0);
  });

  it("keeps a symbol-only plot on its real points", () => {
    const { p, g } = setup();
    g.layers[0].plots[0].showLine = false;
    g.layers[0].plots[0].showMarkers = true;
    const fr = animationFrame(layoutGraph(p, g), anim(), 0.4).layers[0];
    const a = g.layers[0].plots[0];
    expect(fr.data.get(a.id)!.x).toEqual([0]);
    expect(fr.anim!.markers.find((k) => k.plotId === a.id)).toMatchObject({ x: 0, y: 0 });
  });

  it("sweeps a typed range and leaves plots that are not listed alone", () => {
    const { p, g } = setup([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]);
    const [a, b] = g.layers[0].plots;
    const layout = layoutGraph(p, g);
    const an = anim((x) => {
      x.reveal.from = 1;
      x.reveal.to = 3;
      x.reveal.plotIds = [a.id];
    });
    expect(revealRange(layout.layers[0], an.reveal)).toEqual({ from: 1, to: 3 });
    const fr = animationFrame(layout, an, 0.5).layers[0];
    expect(fr.data.get(a.id)!.x).toEqual([0, 1, 2]);
    expect(fr.data.get(b.id)).toBe(layout.layers[0].data.get(b.id));
    expect(fr.anim!.markers.map((k) => k.plotId)).toEqual([a.id]);
  });

  it("applies a typed range only to layers over the same x axis", () => {
    const { p, g } = setup([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]);
    const second = structuredClone(g.layers[0]);
    second.id = "L2";
    second.plots = [{ ...second.plots[0], id: "p2" }];
    second.axes.x.title = "Frequency (Hz)";
    g.layers.push(second);
    const layout = layoutGraph(p, g);
    const an = anim((x) => {
      x.reveal.from = 1;
      x.reveal.to = 3;
    });
    const fr = animationFrame(layout, an, 0.5);
    expect(fr.layers[0].anim!.markers[0].x).toBe(2); // 1 … 3
    expect(fr.layers[1].anim!.markers[0].x).toBe(2); // its own 0 … 4
    expect(animationFrame(layout, an, 0).layers[0].anim!.markers[0].x).toBe(1);
    expect(animationFrame(layout, an, 0).layers[1].anim!.markers[0].x).toBe(0);
    // same title: the range is shared
    second.axes.x.title = g.layers[0].axes.x.title;
    const shared = animationFrame(layoutGraph(p, { ...g, layers: [g.layers[0], { ...second }] }), an, 0);
    expect(shared.layers[1].anim!.markers[0].x).toBe(1);
  });

  it("falls back to the point order when x goes back and forth", () => {
    const { p, g } = setup([0, 2, 1, 3], [0, 1, 2, 3]);
    const a = g.layers[0].plots[0];
    const fr = animationFrame(layoutGraph(p, g), anim(), 0.5).layers[0]; // pos = 1.5
    const d = fr.data.get(a.id)!;
    expect(d.x).toEqual([0, 2, 1.5]);
    expect(d.y[2]).toBeCloseTo(1.5, 9);
    expect(fr.anim!.cursorXMm).toBeNull();
  });

  it("drops or fades what is older than the tail window", () => {
    const { p, g } = setup([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]);
    const a = g.layers[0].plots[0];
    const layout = layoutGraph(p, g);
    const hide = animationFrame(layout, anim((x) => void (x.reveal.tail = { mode: "hide", window: 1.5 })), 0.75).layers[0]; // c = 3
    expect(hide.data.get(a.id)!.x).toEqual([1.5, 2, 3]);
    expect(hide.anim!.partial.get(a.id)).toEqual({ head: true, tail: false });
    expect(hide.anim!.tailMask.size).toBe(0);
    const fade = animationFrame(layout, anim((x) => void (x.reveal.tail = { mode: "fade", window: 1.5 })), 0.75).layers[0];
    const mask = fade.anim!.tailMask.get(a.id)!;
    expect(mask.x1Mm).toBeCloseTo(layout.layers[0].x.scale.map(3)!, 9);
    expect(mask.x0Mm).toBeCloseTo(layout.layers[0].x.scale.map(1.5)!, 9);
  });

  it("slides the x axis with the current point when the axes follow", () => {
    const { p, g } = setup([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const layout = layoutGraph(p, g);
    const an = anim((x) => {
      x.reveal.axes = "follow";
      x.reveal.followWindow = 4;
    });
    const early = animationFrame(layout, an, 0.2).layers[0]; // c = 2: the window still starts at the beginning
    expect([early.x.scale.from, early.x.scale.to]).toEqual([0, 4]);
    const late = animationFrame(layout, an, 0.8).layers[0]; // c = 8
    expect([late.x.scale.from, late.x.scale.to]).toEqual([4, 8]);
    expect(late.y).toBe(layout.layers[0].y);
    const f = g.layers[0].frame;
    expect(late.anim!.markers[0].xMm).toBeCloseTo(f.xMm + f.wMm, 6);
    // points left of the window are not drawn (one is kept for the line to enter from the edge)
    expect(late.data.get(g.layers[0].plots[0].id)!.x[0]).toBe(3);
  });

  it("builds the figure up plot by plot, legend entries included", () => {
    const { p, g } = setup();
    const layout = layoutGraph(p, g);
    const [a, b] = g.layers[0].plots;
    const an = anim((x) => {
      x.reveal.enabled = false;
      x.buildUp.enabled = true;
      x.buildUp.transition = "fade";
      x.buildUp.fadeFraction = 0.5;
    });
    const first = animationFrame(layout, an, 0.1).layers[0]; // step 0, local 0.2
    expect(first.layer.plots.map((q) => q.visible)).toEqual([true, false]);
    expect(first.layer.plots[0]).toBe(a); // shown plots keep their identity
    expect(first.legend.entries.map((e) => e.plot.id)).toEqual([a.id]);
    expect(first.anim!.plotOpacity.get(a.id)).toBeCloseTo(0.4, 9);
    const second = animationFrame(layout, an, 0.9).layers[0];
    expect(second.layer.plots.map((q) => q.visible)).toEqual([true, true]);
    expect(second.legend.entries.length).toBe(2);
    expect(second.anim?.plotOpacity.has(b.id) ?? false).toBe(false);
    expect(animationFrame(layout, an, 1)).toBe(layout);
    // with reveal on as well, each plot is drawn during its own step
    const both = animationFrame(layout, anim((x) => void (x.buildUp.enabled = true)), 0.25).layers[0]; // step 0, local 0.5
    expect(both.data.get(a.id)!.x).toEqual([0, 1]);
    expect(both.layer.plots[1].visible).toBe(false);
    // only the plot being drawn carries the symbol
    const later = animationFrame(layout, anim((x) => void (x.buildUp.enabled = true)), 0.75).layers[0];
    expect(later.anim!.markers.map((m) => m.plotId)).toEqual([b.id]);
  });

  it("rotates a 3D view between its end angles", () => {
    const p = newProject("3d");
    const sh = p.sheets[0];
    sh.columns[0].values = [0, 1, 2];
    sh.columns[1].values = [0, 1, 0];
    sh.columns.push({ id: "z", longName: "", units: "", designation: "Y", values: [0, 1, 2] });
    const g = newGraph(p.defaults, "G");
    const l = g.layers[0];
    make3D(p.defaults, l);
    l.plots.push(newPlot(p.defaults, l, { sheetId: sh.id, xColId: sh.columns[0].id, yColId: sh.columns[1].id, zColId: "z" }, "t", "scatter3d"));
    l.plots[0].joinPoints = true;
    p.graphs.push(g);
    const layout = layoutGraph(p, g);
    const an = anim((x) => {
      x.reveal.enabled = false;
      x.rotate = { enabled: true, azimuthFrom: 10, azimuthTo: 100, elevationFrom: 20, elevationTo: 40, easing: "inOut" };
    });
    const at = (t: number) => animationFrame(layout, an, t).layers[0];
    expect(at(0).layer.view3d).toMatchObject({ azimuth: 10, elevation: 20 });
    expect(at(1).layer.view3d).toMatchObject({ azimuth: 100, elevation: 40 });
    expect(at(0.5).layer.view3d!.azimuth).toBeCloseTo(55, 9);
    expect(at(0.5).projector).not.toBe(layout.layers[0].projector);
    expect(at(0.5).x).toBe(layout.layers[0].x);
    expect(l.view3d!.azimuth).toBe(35); // the document is untouched
    // a 3D trajectory reveals in point order, its symbol projected with a depth
    const tr = animationFrame(layout, anim(), 0.25).layers[0]; // pos = 0.5
    const d = tr.data.get(l.plots[0].id) as unknown as { x: number[]; z: number[] };
    expect(d.x).toEqual([0, 0.5]);
    expect(d.z[1]).toBeCloseTo(0.5, 9);
    expect(tr.anim!.markers[0].depth).toBeTypeOf("number");
  });

  it("schedules frames and playback", () => {
    const s = frameSchedule({ durationS: 2, fps: 10, holdEndS: 0.5 });
    expect(s.count).toBe(26);
    expect(s.tAt(0)).toBe(0);
    expect(s.tAt(10)).toBeCloseTo(0.5, 9);
    expect(s.tAt(20)).toBe(1);
    expect(s.tAt(25)).toBe(1);
    const a = { durationS: 2, fps: 10, holdEndS: 0.5, loop: false };
    expect(playbackFrame(1, a)).toEqual({ index: 10, done: false });
    expect(playbackFrame(9, a)).toEqual({ index: 25, done: true });
    expect(playbackFrame(2.6 + 1, { ...a, loop: true })).toEqual({ index: 10, done: false });
    expect(ease("inOut", 0.5)).toBeCloseTo(0.5, 9);
    expect(ease("inOut", 0)).toBe(0);
    expect(ease("linear", 2)).toBe(1);
  });
});
