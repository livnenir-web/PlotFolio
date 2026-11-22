import { describe, expect, it } from "vitest";
import { cutPolylineEnd, lineEndOf, linePath, shapeSmoothing, smoothPath, smoothPolyline3 } from "./paths";

const tri: [number, number][] = [
  [0, 0],
  [10, 0],
  [5, 8],
];

describe("smoothPath", () => {
  it("draws straight segments at 0 and closes polygons", () => {
    expect(smoothPath(tri, 0, false)).toBe("M0 0L10 0L5 8");
    expect(smoothPath(tri, 0, true)).toBe("M0 0L10 0L5 8Z");
  });
  it("uses cubic curves when smoothed, one per segment, and wraps around closed shapes", () => {
    const open = smoothPath(tri, 1, false);
    const closed = smoothPath(tri, 1, true);
    expect(open.match(/C/g)?.length).toBe(2);
    expect(closed.match(/C/g)?.length).toBe(3);
    expect(closed.endsWith("Z")).toBe(true);
    expect(open.endsWith("Z")).toBe(false);
  });
  it("interpolates the tangent length with the amount", () => {
    const half = smoothPath(tri, 0.5, false);
    const full = smoothPath(tri, 1, false);
    const c = (d: string) => Number(d.match(/C([\d.-]+)/)![1]);
    // first control point moves away from the vertex as the smoothing grows
    expect(c(half)).toBeGreaterThan(0);
    expect(c(full)).toBeGreaterThan(c(half));
  });
  it("reads the legacy smooth flag", () => {
    expect(shapeSmoothing({ smooth: true })).toBe(1);
    expect(shapeSmoothing({})).toBe(0);
    expect(shapeSmoothing({ smooth: true, smoothing: 0.3 })).toBe(0.3);
  });
});

describe("line smoothing", () => {
  const pts: [number, number][] = [[0, 0], [10, 5], [20, 0], [30, 5]];
  it("draws the full spline at 100 % and straight segments at 0 %", () => {
    expect(linePath(pts, "spline", 1)).toBe(linePath(pts, "spline"));
    expect(linePath(pts, "spline", 0)).toBe(linePath(pts, "straight"));
    expect(linePath(pts, "spline", 0.5)).not.toBe(linePath(pts, "spline"));
  });
  it("smooths 3D lines through the points, one sampled piece per segment", () => {
    const p3: [number, number, number][] = [[0, 0, 0], [1, 1, 0], [2, 0, 1], [3, 1, 1]];
    const pieces = smoothPolyline3(p3, "spline", 1, 4);
    expect(pieces).toHaveLength(3);
    pieces.forEach((piece, i) => {
      expect(piece).toHaveLength(5);
      expect(piece[0]).toEqual(p3[i]);
      expect(piece[4][0]).toBeCloseTo(p3[i + 1][0]);
      expect(piece[4][2]).toBeCloseTo(p3[i + 1][2]);
    });
    expect(smoothPolyline3(p3, "straight")).toEqual([[p3[0], p3[1]], [p3[1], p3[2]], [p3[2], p3[3]]]);
    const b = smoothPolyline3(p3, "bspline", 1, 4);
    expect(b[0][0]).toEqual(p3[0]);
    expect(b[b.length - 1][4][1]).toBeCloseTo(p3[3][1]);
  });
});

describe("line ends", () => {
  it("shortens a polyline along its segments, by half its length at most", () => {
    const pts: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 1],
    ];
    expect(cutPolylineEnd(pts, 0)).toBe(pts);
    // 3 back from the end: past the 1-long last segment, 2 into the first
    expect(cutPolylineEnd(pts, 3)).toEqual([
      [0, 0],
      [8, 0],
    ]);
    const cut = cutPolylineEnd(pts, 100);
    expect(cut[cut.length - 1]).toEqual([5.5, 0]);
  });

  it("reads the shape at each end, an arrow unless another is named", () => {
    expect(lineEndOf({ headStart: false, headEnd: true }, "end")).toBe("arrow");
    expect(lineEndOf({ headStart: false, headEnd: true }, "start")).toBeNull();
    expect(lineEndOf({ headStart: true, headEnd: false, headStartShape: "circle" }, "start")).toBe("circle");
  });
});
