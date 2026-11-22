import { beforeEach, describe, expect, it } from "vitest";
import { axisLookOf, effectiveAxis } from "../graph/layout";
import { beginEdit, endEdit, pauseHistory, resumeHistory, undo, useStore } from "./store";

const st = () => useStore.getState();
const history = () => useStore.temporal.getState();
const graph = () => st().project.graphs.find((g) => g.id === gid)!;
const xAxis = () => graph().layers[0].axes.x;
const yAxis = () => graph().layers[0].axes.y;
let gid = "";
let lid = "";

/** What a number field does: a live edit that keeps the target it started with. */
function typeInto(commit: (v: number) => void, values: number[], cancel = false) {
  const end = () => (cancel ? false : undefined);
  beginEdit(end);
  for (const v of values) commit(v);
  return end;
}

beforeEach(() => {
  endEdit();
  resumeHistory();
  gid = st().addGraph("Edit sessions");
  lid = graph().layers[0].id;
  st().updateGraph(gid, (g) => {
    for (const w of ["x", "y"] as const) Object.assign(g.layers[0].axes[w], { auto: false, from: 0, to: 10 });
  });
  history().clear();
});

describe("field edits", () => {
  it("land on the object they were typed for when another one is selected, as one undo step", () => {
    st().setSelection({ kind: "axis", graphId: gid, layerId: lid, axis: "x" });
    typeInto((v) => st().updateAxis(gid, lid, "x", (a) => void (a.to = v)), [2, 25, 250]);
    expect(history().isTracking).toBe(false);
    // clicking the Y axis ends the edit before the selection moves on
    st().setSelection({ kind: "axis", graphId: gid, layerId: lid, axis: "y" });
    expect(history().isTracking).toBe(true);
    expect(xAxis().to).toBe(250);
    expect(yAxis().to).toBe(10);
    expect(history().pastStates.length).toBe(1);
    undo();
    expect(xAxis().to).toBe(10);
  });

  it("never swallow the action that follows: one undo takes back only the move", () => {
    typeInto((v) => st().updateGraph(gid, (g) => void (g.canvas.widthMm = v)), [1, 12, 120]);
    // a drag that writes once at its end, started while the field still had the focus
    st().setSelection({ kind: "layer", graphId: gid, layerId: lid });
    const x0 = graph().layers[0].frame.xMm;
    st().updateGraph(gid, (g) => void (g.layers[0].frame.xMm = x0 + 7));
    expect(history().pastStates.length).toBe(2);
    undo();
    expect(graph().layers[0].frame.xMm).toBe(x0);
    expect(graph().canvas.widthMm).toBe(120);
    undo();
    expect(graph().canvas.widthMm).not.toBe(120);
  });

  it("are one undo step even when the field started empty, and leave no step when thrown away", () => {
    expect(xAxis().majorStep).toBeNull();
    typeInto((v) => st().updateAxis(gid, lid, "x", (a) => void (a.majorStep = v)), [0, 0.5]);
    endEdit();
    expect(xAxis().majorStep).toBe(0.5);
    expect(history().pastStates.length).toBe(1);
    undo();
    expect(xAxis().majorStep).toBeNull();
    history().clear();
    // Escape: nothing changes and nothing is recorded
    typeInto((v) => st().updateAxis(gid, lid, "x", (a) => void (a.to = v)), [3, 33], true);
    endEdit();
    expect(xAxis().to).toBe(10);
    expect(history().pastStates.length).toBe(0);
    expect(history().isTracking).toBe(true);
  });

  it("end before a drag pauses history and before undo", () => {
    typeInto((v) => st().updateAxis(gid, lid, "x", (a) => void (a.to = v)), [40]);
    pauseHistory(); // a drag begins
    st().updateGraph(gid, (g) => void (g.layers[0].frame.wMm = 77));
    resumeHistory();
    st().updateGraph(gid, (g) => void (g.layers[0].frame.wMm = 80));
    expect(history().pastStates.length).toBe(2);
    undo();
    expect(xAxis().to).toBe(40);
    typeInto((v) => st().updateAxis(gid, lid, "x", (a) => void (a.to = v)), [55]);
    undo(); // ends the edit, then takes it back
    expect(xAxis().to).toBe(40);
    expect(history().isTracking).toBe(true);
  });

  it("an edit that is not the open one cannot end it", () => {
    const first = typeInto((v) => st().updateAxis(gid, lid, "x", (a) => void (a.to = v)), [41]);
    typeInto((v) => st().updateAxis(gid, lid, "y", (a) => void (a.to = v)), [42]); // ends the first
    endEdit(first);
    expect(history().isTracking).toBe(false);
    endEdit();
    expect(history().pastStates.length).toBe(2);
  });
});

describe("same style as X axis", () => {
  it("shares the look only, and unlinking with the look of X changes nothing that is drawn", () => {
    st().updateGraph(gid, (g) => {
      const { x, y } = g.layers[0].axes;
      Object.assign(x, { tickDir: "in", lineWidthPt: 2, minorCount: 4, grid: true, mirror: true });
      Object.assign(y, { sameAsX: true, tickDir: "out", lineWidthPt: 0.5, minorCount: 1, grid: false, mirror: false });
    });
    const linked = effectiveAxis(graph().layers[0], "y");
    expect([linked.tickDir, linked.lineWidthPt]).toEqual(["in", 2]);
    expect([linked.minorCount, linked.grid, linked.mirror, linked.to]).toEqual([1, false, false, 10]);
    st().updateGraph(gid, (g) => {
      const l = g.layers[0];
      Object.assign(l.axes.y, axisLookOf(l.axes.x));
      l.axes.y.sameAsX = false;
    });
    expect(effectiveAxis(graph().layers[0], "y")).toEqual({ ...linked, sameAsX: false });
    expect(yAxis().titleStyle).not.toBe(xAxis().titleStyle);
  });
});
