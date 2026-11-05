import { describe, expect, it } from "vitest";
import { shapeSmoothing, smoothPath } from "./paths";

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
