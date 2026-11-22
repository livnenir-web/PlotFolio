import { describe, expect, it } from "vitest";
import { newGraph, newLayer, newPlot, newProject } from "../model/defaults";
import { layoutGraph, pageContent } from "../graph/layout";
import { deserializeProject, serializeProject } from "../io/project";
import { graphToSvg } from "./exportGraph";

describe("outside the canvas", () => {
  /** A figure with a second layer and a label parked right of the page. */
  function setup() {
    const p = newProject("desk");
    const g = newGraph(p.defaults, "G");
    g.canvas.autoHeight = false;
    g.canvas.heightMm = 70;
    const draft = newLayer(p.defaults, "draft", { xMm: 120, yMm: 5, wMm: 40, hMm: 40 });
    draft.axes.x.title = "Draft axis";
    g.layers.push(draft);
    const style = { ...p.defaults.tickLabel };
    g.layers[0].texts.push({ id: "in", text: "On the page", xMm: 30, yMm: 20, style, rotation: 0, anchor: "start" });
    g.layers[0].texts.push({ id: "out", text: "A note", xMm: 200, yMm: 20, style, rotation: 0, anchor: "start" });
    g.layers[0].texts.push({ id: "edge", text: "Across the edge", xMm: 80, yMm: 30, style, rotation: 0, anchor: "start" });
    p.graphs.push(g);
    return { p, g, draft };
  }
  it("leaves out of the export what lies wholly outside, and keeps what touches the page", () => {
    const { p, g } = setup();
    const full = layoutGraph(p, g);
    const { layout, left } = pageContent(full);
    expect(left).toBe(2); // the draft layer and the note
    expect(layout.layers.map((l) => l.layer.name)).toEqual([g.layers[0].name]);
    expect(layout.layers[0].layer.texts.map((t) => t.id)).toEqual(["in", "edge"]);
    expect(full.layers[0].layer.texts).toHaveLength(3); // the figure itself is untouched
    const svg = graphToSvg(p, g);
    expect(svg).toContain("On the page");
    expect(svg).toContain("Across the edge");
    expect(svg).not.toContain("A note");
    expect(svg).not.toContain("Draft axis");
  });
  it("returns the same layout when everything is on the page", () => {
    const p = newProject();
    const g = newGraph(p.defaults);
    p.graphs.push(g);
    const full = layoutGraph(p, g);
    expect(pageContent(full)).toEqual({ layout: full, left: 0 });
    expect(pageContent(full).layout).toBe(full);
  });
  it("does not stretch an automatic canvas height for a layer parked beside the page", () => {
    const { p, g } = setup();
    // layouts are cached by object, so every variant is a figure of its own
    const variant = (xMm: number, yMm: number) => {
      const copy = structuredClone(g);
      copy.canvas.autoHeight = true;
      Object.assign(copy.layers[1].frame, { xMm, yMm });
      return layoutGraph(p, copy).heightMm;
    };
    const before = variant(120, 5);
    expect(variant(120, 200)).toBe(before);
    expect(variant(20, 200)).toBeGreaterThan(before + 100); // on the page: now it counts
  });
});

describe("layout and export sizes", () => {
  it("lays out the default graph on an 87 mm canvas with a 50 mm data area", () => {
    const p = newProject();
    const g = newGraph(p.defaults);
    p.graphs.push(g);
    const l = layoutGraph(p, g);
    expect(l.widthMm).toBe(87);
    expect(g.layers[0].frame).toEqual({ xMm: 20, yMm: 5, wMm: 50, hMm: 50 });
    expect(l.heightMm).toBeGreaterThan(55);
    expect(l.heightMm).toBeLessThan(75);
    // raster size at 300 dpi
    const px = Math.round((l.widthMm / 25.4) * 300);
    expect(px).toBe(1028);
  });

  it("round-trips a project through the file format", () => {
    const p = newProject("Round trip");
    p.sheets[0].columns[0].values = [1, 2, 3];
    p.sheets[0].columns[1].formula = "A*2";
    p.graphs.push(newGraph(p.defaults, "G"));
    const text = serializeProject(p);
    const back = deserializeProject(text);
    expect(back.name).toBe("Round trip");
    expect(back.sheets[0].columns[1].formula).toBe("A*2");
    expect(back.graphs[0].layers[0].axes.x.title).toBe("X axis title");
    expect(back.defaults.colors[0]).toBe("#0072B2");
  });

  it("keeps the symbols of 3D scatters saved before version 2 and honors the setting after", () => {
    const p = newProject("3D");
    const g = newGraph(p.defaults, "G");
    g.layers[0].plots.push(newPlot(p.defaults, g.layers[0], { sheetId: p.sheets[0].id, xColId: null, yColId: "" }, "pts", "scatter3d"));
    p.graphs.push(g);
    expect(g.layers[0].plots[0].showMarkers).toBe(true);
    const old = JSON.parse(serializeProject(p, null));
    old.version = 1;
    old.graphs[0].layers[0].plots[0].showMarkers = false; // what version-1 files hold
    expect(deserializeProject(JSON.stringify(old)).graphs[0].layers[0].plots[0].showMarkers).toBe(true);
    old.version = 2; // switched off on purpose
    expect(deserializeProject(JSON.stringify(old)).graphs[0].layers[0].plots[0].showMarkers).toBe(false);
  });

  it("rejects files that are not projects", () => {
    expect(() => deserializeProject('{"hello": 1}')).toThrow();
  });
});

describe("animation export", () => {
  it("keeps the markup of a figure without animation and of a complete animated figure", async () => {
    const { graphToSvg, layoutToSvg } = await import("./exportGraph");
    const { animationFrame } = await import("../graph/animation");
    const { defaultAnimation } = await import("../model/defaults");
    const p = newProject("anim");
    p.sheets[0].columns[0].values = [0, 1, 2, 3];
    p.sheets[0].columns[1].values = [0, 2, 1, 3];
    const g = newGraph(p.defaults, "G");
    g.layers[0].plots.push(newPlot(p.defaults, g.layers[0], { sheetId: p.sheets[0].id, xColId: p.sheets[0].columns[0].id, yColId: p.sheets[0].columns[1].id }, "a", "line"));
    p.graphs.push(g);
    const plain = graphToSvg(p, g);
    expect(layoutToSvg(layoutGraph(p, g))).toBe(plain);
    expect(plain).not.toContain("anim");
    // pictures of an animated figure show it complete, exactly as without the animation
    const animated = { ...g, animation: defaultAnimation() };
    expect(graphToSvg(p, animated)).toBe(plain);
    // a frame half-way: part of the line, the current point and nothing else new
    const frame = layoutToSvg(animationFrame(layoutGraph(p, animated), animated.animation, 0.5));
    expect(frame).toContain('class="current-point"');
    expect(frame.length).toBeLessThan(plain.length + 400);
    // switched off: nothing changes
    const off = { ...g, animation: { ...defaultAnimation(), enabled: false } };
    expect(layoutToSvg(animationFrame(layoutGraph(p, off), off.animation, 0.5))).toBe(plain);
  });

  it("sizes frames evenly and spreads GIF delays so the total time is right", async () => {
    const { animationFrameSize, gifDelayMs, videoBitrate } = await import("./exportAnimation");
    expect(animationFrameSize({ widthMm: 87, heightMm: 47 }, 1920)).toEqual({ width: 1920, height: 1038 });
    expect(animationFrameSize({ widthMm: 87, heightMm: 47 }, 801).width % 2).toBe(0);
    let total = 0;
    for (let i = 0; i < 30; i++) total += gifDelayMs(i, 30);
    expect(total).toBe(1000);
    expect(gifDelayMs(30, 30, 30)).toBe(1000); // a pause of 30 frames as one long frame
    expect(videoBitrate(1920, 1080, 30, "high")).toBeGreaterThan(videoBitrate(1920, 1080, 30, "normal"));
  });
});
