import { describe, expect, it } from "vitest";
import { insertionIndex, landingIndex, moveItem } from "./reorder";

describe("drag to reorder", () => {
  const rows = [0, 20, 40].map((start) => ({ start, end: start + 20 }));
  it("inserts before the row whose middle the pointer has not passed", () => {
    expect(insertionIndex(rows, -5)).toBe(0);
    expect(insertionIndex(rows, 9)).toBe(0);
    expect(insertionIndex(rows, 11)).toBe(1);
    expect(insertionIndex(rows, 49)).toBe(2);
    expect(insertionIndex(rows, 51)).toBe(3);
    expect(insertionIndex([], 5)).toBe(0);
  });
  it("lands where the row was dropped, counting without the row itself", () => {
    // dropping just above or just below itself changes nothing
    expect(landingIndex(1, 1)).toBe(1);
    expect(landingIndex(1, 2)).toBe(1);
    expect(landingIndex(0, 3)).toBe(2);
    expect(landingIndex(2, 0)).toBe(0);
    expect(moveItem(["a", "b", "c"], 0, landingIndex(0, 3))).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, landingIndex(2, 1))).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 7, 0)).toEqual(["a", "b", "c"]);
  });
});
