import { describe, expect, it } from "vitest";
import { formatCustomTicks, parseCustomTicks } from "./customTicks";

describe("custom tick text", () => {
  it("parses values with optional labels and ignores junk", () => {
    expect(parseCustomTicks("0, 3.1416=\\pi; 6.2832 = 2\\pi\nabc, 1e3")).toEqual([{ value: 0 }, { value: 3.1416, label: "\\pi" }, { value: 6.2832, label: "2\\pi" }, { value: 1000 }]);
  });
  it("round-trips through formatting", () => {
    const t = [{ value: -1.5 }, { value: 2, label: "two" }];
    expect(parseCustomTicks(formatCustomTicks(t))).toEqual(t);
    expect(formatCustomTicks(undefined)).toBe("");
  });
});
