import { describe, expect, it } from "vitest";
import { newGraph, newProject } from "../model/defaults";
import { layoutGraph } from "../graph/layout";
import { deserializeProject, serializeProject } from "../io/project";

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

  it("rejects files that are not projects", () => {
    expect(() => deserializeProject('{"hello": 1}')).toThrow();
  });
});
