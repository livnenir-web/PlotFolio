import { describe, expect, it } from "vitest";
import { axisLock, snapDirection } from "./constrain";

describe("Shift constraints", () => {
  it("keeps the larger displacement when moving", () => {
    expect(axisLock(5, 2)).toEqual([5, 0]);
    expect(axisLock(-1, 3)).toEqual([0, 3]);
  });

  it("snaps a line end to 45° steps about the fixed end", () => {
    const [x, y] = snapDirection(0, 0, 10, 1);
    expect(x).toBeCloseTo(10, 10);
    expect(y).toBeCloseTo(0, 10);
    const [u, v] = snapDirection(1, 1, 5, 6); // nearly diagonal
    expect(u - 1).toBeCloseTo(v - 1, 10);
    expect(u).toBeCloseTo(5.5, 10);
  });

  it("lets a line grow along its own direction", () => {
    const keep = Math.atan2(1, 3); // about 18°, not a 45° step
    const [x, y] = snapDirection(0, 0, 6.1, 1.9, keep);
    expect(y / x).toBeCloseTo(1 / 3, 10);
    // far from the line's direction the 45° steps still apply
    const [a, b] = snapDirection(0, 0, 0.2, 7, keep);
    expect(a).toBeCloseTo(0, 10);
    expect(b).toBeCloseTo(7, 10);
  });
});
