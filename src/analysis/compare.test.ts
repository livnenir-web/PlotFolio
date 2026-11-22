import { describe, expect, it } from "vitest";
import { anova, ecdf, formatP, holm, ksTest, pairwiseT, stars, tTest, tukeyHsd } from "./compare";
import { normalCdf, tukeyUpperP } from "./distributions";
// Reference values from SciPy 1.16 (ttest_ind, ttest_rel, f_oneway, tukey_hsd, ks_2samp exact, studentized_range, norm).
import ref from "./compare.reference.json";

const close = (got: number, want: number, rel = 1e-6) => expect(Math.abs(got - want)).toBeLessThanOrEqual(rel * Math.max(1e-12, Math.abs(want)));

describe("distributions", () => {
  it("normal cumulative distribution", () => {
    for (const [z, p] of ref.norm) close(normalCdf(z), p, 1e-9);
  });
  it("studentized range upper tail", () => {
    for (const [q, k, df, p] of ref.ptukey) close(tukeyUpperP(q, k, df), p, 2e-4);
  });
});

describe("t-test", () => {
  it("Welch: statistic, degrees of freedom, p value and confidence interval", () => {
    const r = tTest(ref.a, ref.b)!;
    close(r.t, ref.welch[0]);
    close(r.df, ref.welch[1]);
    close(r.p, ref.welch[2]);
    close(r.ciLow, ref.welch[3]);
    close(r.ciHigh, ref.welch[4]);
  });
  it("equal variances", () => {
    const r = tTest(ref.a, ref.b, "student")!;
    close(r.t, ref.student[0]);
    expect(r.df).toBe(ref.student[1]);
    close(r.p, ref.student[2]);
  });
  it("paired, leaving out rows with a missing value", () => {
    const a = [...ref.a, 5, NaN];
    const b = [...ref.b.slice(0, 18), NaN, 7];
    const r = tTest(a, b, "paired")!;
    close(r.t, ref.paired[0]);
    expect(r.df).toBe(ref.paired[1]);
    close(r.p, ref.paired[2]);
  });
  it("is undefined without spread or with too few values", () => {
    expect(tTest([1, 1, 1], [1, 1, 1])).toBeNull();
    expect(tTest([1], [2, 3])).toBeNull();
  });
});

describe("ANOVA and pairwise comparisons", () => {
  it("one-way ANOVA", () => {
    const r = anova([ref.a, ref.b, ref.c])!;
    close(r.f, ref.anova[0]);
    close(r.p, ref.anova[1], 1e-5);
    expect(r.dfBetween).toBe(2);
    expect(r.dfWithin).toBe(ref.a.length + ref.b.length + ref.c.length - 3);
  });
  it("Tukey HSD", () => {
    const pairs = tukeyHsd([ref.a, ref.b, ref.c])!;
    expect(pairs.map((x) => [x.a, x.b])).toEqual([[0, 1], [0, 2], [1, 2]]);
    pairs.forEach((x, i) => close(x.p, ref.tukey[i], 2e-3));
  });
  it("Holm correction keeps the order and never lowers a p value", () => {
    expect(holm([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06]);
    const pairs = pairwiseT([ref.a, ref.b, ref.c]);
    const raw = tTest(ref.a, ref.c)!.p;
    expect(pairs[1].p).toBeGreaterThanOrEqual(raw);
    expect(pairs[1].p).toBeLessThanOrEqual(3 * raw * 1.0000001);
  });
});

describe("Kolmogorov–Smirnov", () => {
  it("statistic and exact p value", () => {
    const r = ksTest(ref.a, ref.b)!;
    close(r.d, ref.ks[0]);
    close(r.p, ref.ks[1], 1e-6);
    const r2 = ksTest(ref.a, ref.c)!;
    close(r2.d, ref.ks2[0]);
    close(r2.p, ref.ks2[1], 1e-6);
  });
  it("larger samples", () => {
    const r = ksTest(ref.ksBig[2] as number[], ref.ksBig[3] as number[])!;
    close(r.d, ref.ksBig[0] as number);
    close(r.p, ref.ksBig[1] as number, 1e-5);
  });
  it("identical samples differ by nothing", () => {
    const r = ksTest([1, 2, 3], [1, 2, 3])!;
    expect(r.d).toBe(0);
    expect(r.p).toBe(1);
  });
});

describe("cumulative distribution and labels", () => {
  it("counts values up to each distinct value", () => {
    const e = ecdf([3, 1, 2, 2, NaN]);
    expect(e).toEqual({ x: [1, 2, 3], count: [1, 3, 4], n: 4 });
  });
  it("stars and p text", () => {
    expect([0.2, 0.05, 0.01, 0.001, 0.0001].map(stars)).toEqual(["ns", "*", "**", "***", "****"]);
    expect(formatP(0.21)).toBe("p = 0.21");
    expect(formatP(0.012)).toBe("p = 0.012");
    expect(formatP(0.0032)).toBe("p = 0.0032");
    expect(formatP(0.00001)).toBe("p < 0.0001");
  });
});
