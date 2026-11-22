import { describe, expect, it } from "vitest";
import { newGraph, newLayer, newProject } from "./defaults";
import { undo, useStore } from "./store";

const st = () => useStore.getState();
const names = (kind: "sheets" | "graphs" | "folders") => (st().project[kind] ?? []).map((x) => x.name).join(" ");

/** Sheets S1…S3 and graphs G1…G3 at the root of a fresh project. */
function setup() {
  const p = newProject("order");
  p.sheets[0].name = "S1";
  st().resetProject(p);
  st().addSheet("S2");
  st().addSheet("S3");
  for (const n of ["G1", "G2", "G3"]) st().addGraph(n);
  const id = (name: string) => [...st().project.sheets, ...st().project.graphs, ...(st().project.folders ?? [])].find((x) => x.name === name)!.id;
  return { id };
}

describe("order of the project list", () => {
  it("puts a sheet or figure next to another of its kind", () => {
    const { id } = setup();
    st().placeItem({ kind: "sheet", id: id("S3") }, id("S1"), false);
    expect(names("sheets")).toBe("S3 S1 S2");
    st().placeItem({ kind: "sheet", id: id("S3") }, id("S2"), true);
    expect(names("sheets")).toBe("S1 S2 S3");
    st().placeItem({ kind: "graph", id: id("G1") }, id("G2"), true);
    expect(names("graphs")).toBe("G2 G1 G3");
    st().placeItem({ kind: "graph", id: id("G1") }, id("G1"), true); // onto itself: nothing
    st().placeItem({ kind: "graph", id: id("G1") }, id("S1"), true); // a sheet is no place for a figure
    expect(names("graphs")).toBe("G2 G1 G3");
  });
  it("takes the folder of the row it is dropped next to", () => {
    const { id } = setup();
    const f = st().addFolder("F");
    st().moveToFolder({ kind: "sheet", id: id("S2") }, f);
    st().placeItem({ kind: "sheet", id: id("S1") }, id("S2"), true);
    expect(names("sheets")).toBe("S2 S1 S3");
    expect(st().project.sheets.map((s) => s.folderId ?? null)).toEqual([f, f, null]);
  });
  it("orders folders among their siblings, never inside themselves", () => {
    setup();
    const a = st().addFolder("A");
    const b = st().addFolder("B");
    const c = st().addFolder("C", a);
    st().placeFolder(b, a, false);
    expect(names("folders")).toBe("B A C");
    st().placeFolder(b, c, true); // next to C: into A
    expect(names("folders")).toBe("A C B");
    expect(st().project.folders!.find((x) => x.id === b)!.parentId).toBe(a);
    st().placeFolder(a, c, false); // A next to its own child: refused
    expect(names("folders")).toBe("A C B");
    expect(st().project.folders!.find((x) => x.id === a)!.parentId).toBeNull();
  });
});

describe("order of tabs and layers", () => {
  it("moves an open tab before or after another", () => {
    const { id } = setup();
    const tab = (n: string) => ({ kind: "graph" as const, id: id(n) });
    for (const n of ["G1", "G2", "G3"]) st().openTab(tab(n));
    const open = () => st().ui.openTabs.filter((t) => t.kind === "graph").map((t) => st().project.graphs.find((g) => g.id === t.id)!.name).join(" ");
    expect(open()).toBe("G1 G2 G3");
    st().moveTab(tab("G3"), tab("G1"), false);
    expect(open()).toBe("G3 G1 G2");
    st().moveTab(tab("G3"), tab("G2"), true);
    expect(open()).toBe("G1 G2 G3");
    const dirty = st().dirty;
    st().moveTab(tab("G1"), tab("G1"), true);
    expect(open()).toBe("G1 G2 G3");
    expect(st().dirty).toBe(dirty);
  });
  it("changes the drawing order of the layers in one undo step", () => {
    const p = newProject("layers");
    const g = newGraph(p.defaults, "G");
    g.layers = ["L1", "L2", "L3"].map((n) => newLayer(p.defaults, n, { ...p.defaults.frame }));
    p.graphs.push(g);
    st().resetProject(p);
    const order = () => st().project.graphs[0].layers.map((l) => l.name).join(" ");
    st().moveLayer(g.id, 0, 2);
    expect(order()).toBe("L2 L3 L1");
    st().moveLayer(g.id, 5, 0);
    expect(order()).toBe("L2 L3 L1");
    undo();
    expect(order()).toBe("L1 L2 L3");
  });
});
