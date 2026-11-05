import type { ColormapName, ColormapOptions } from "../model/types";

type Stop = [number, number, number];

/** ColorBrewer-style maps given as hex stops. */
const fromHex = (...hexes: string[]): Stop[] => hexes.map((h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);

// Sampled control points (8-9 per map); interpolated linearly in RGB.
const MAPS: Record<ColormapName, Stop[]> = {
  custom: [
    [255, 255, 255],
    [0, 114, 178],
  ],
  turbo: fromHex("30123b", "4662d7", "36aaf9", "1ae4b6", "72fe5e", "c7ef34", "faba39", "f66b19", "ca2a04", "7a0403"),
  greens: fromHex("f7fcf5", "e5f5e0", "c7e9c0", "a1d99b", "74c476", "41ab5d", "238b45", "006d2c", "00441b"),
  blues: fromHex("f7fbff", "deebf7", "c6dbef", "9ecae1", "6baed6", "4292c6", "2171b5", "08519c", "08306b"),
  reds: fromHex("fff5f0", "fee0d2", "fcbba1", "fc9272", "fb6a4a", "ef3b2c", "cb181d", "a50f15", "67000d"),
  oranges: fromHex("fff5eb", "fee6ce", "fdd0a2", "fdae6b", "fd8d3c", "f16913", "d94801", "a63603", "7f2704"),
  purples: fromHex("fcfbfd", "efedf5", "dadaeb", "bcbddc", "9e9ac8", "807dba", "6a51a3", "54278f", "3f007d"),
  ylorrd: fromHex("ffffcc", "ffeda0", "fed976", "feb24c", "fd8d3c", "fc4e2a", "e31a1c", "bd0026", "800026"),
  ylgnbu: fromHex("ffffd9", "edf8b1", "c7e9b4", "7fcdbb", "41b6c4", "1d91c0", "225ea8", "253494", "081d58"),
  rdbu: fromHex("b2182b", "d6604d", "f4a582", "fddbc7", "f7f7f7", "d1e5f0", "92c5de", "4393c3", "2166ac"),
  rdylgn: fromHex("d73027", "f46d43", "fdae61", "fee08b", "ffffbf", "d9ef8b", "a6d96a", "66bd63", "1a9850"),
  spectral: fromHex("9e0142", "d53e4f", "f46d43", "fdae61", "fee08b", "e6f598", "abdda4", "66c2a5", "3288bd", "5e4fa2"),
  viridis: [
    [68, 1, 84],
    [71, 44, 122],
    [59, 81, 139],
    [44, 113, 142],
    [33, 144, 141],
    [39, 173, 129],
    [92, 200, 99],
    [170, 220, 50],
    [253, 231, 37],
  ],
  plasma: [
    [13, 8, 135],
    [75, 3, 161],
    [125, 3, 168],
    [168, 34, 150],
    [203, 70, 121],
    [229, 107, 93],
    [248, 148, 65],
    [253, 195, 40],
    [240, 249, 33],
  ],
  inferno: [
    [0, 0, 4],
    [31, 12, 72],
    [85, 15, 109],
    [136, 34, 106],
    [186, 54, 85],
    [227, 89, 51],
    [249, 140, 10],
    [249, 201, 50],
    [252, 255, 164],
  ],
  magma: [
    [0, 0, 4],
    [28, 16, 68],
    [79, 18, 123],
    [129, 37, 129],
    [181, 54, 122],
    [229, 80, 100],
    [251, 135, 97],
    [254, 194, 135],
    [252, 253, 191],
  ],
  cividis: [
    [0, 32, 77],
    [24, 52, 103],
    [63, 74, 110],
    [97, 97, 115],
    [128, 121, 120],
    [161, 146, 117],
    [196, 172, 104],
    [231, 199, 81],
    [255, 231, 60],
  ],
  gray: [
    [0, 0, 0],
    [255, 255, 255],
  ],
  hot: [
    [10, 0, 0],
    [180, 0, 0],
    [255, 60, 0],
    [255, 160, 0],
    [255, 230, 60],
    [255, 255, 255],
  ],
  rainbow: [
    [0, 0, 143],
    [0, 0, 255],
    [0, 128, 255],
    [0, 255, 255],
    [128, 255, 128],
    [255, 255, 0],
    [255, 128, 0],
    [255, 0, 0],
    [128, 0, 0],
  ],
  bwr: [
    [0, 0, 255],
    [255, 255, 255],
    [255, 0, 0],
  ],
  coolwarm: [
    [59, 76, 192],
    [122, 157, 236],
    [190, 200, 240],
    [221, 221, 221],
    [238, 190, 170],
    [220, 120, 90],
    [180, 4, 38],
  ],
};

export const COLORMAP_NAMES: { value: ColormapName; label: string }[] = [
  { value: "viridis", label: "Viridis" },
  { value: "plasma", label: "Plasma" },
  { value: "inferno", label: "Inferno" },
  { value: "magma", label: "Magma" },
  { value: "cividis", label: "Cividis" },
  { value: "turbo", label: "Turbo" },
  { value: "gray", label: "Gray" },
  { value: "hot", label: "Hot" },
  { value: "rainbow", label: "Rainbow (jet)" },
  { value: "greens", label: "Greens" },
  { value: "blues", label: "Blues" },
  { value: "reds", label: "Reds" },
  { value: "oranges", label: "Oranges" },
  { value: "purples", label: "Purples" },
  { value: "ylorrd", label: "Yellow–orange–red" },
  { value: "ylgnbu", label: "Yellow–green–blue" },
  { value: "bwr", label: "Blue–white–red" },
  { value: "coolwarm", label: "Cool–warm" },
  { value: "rdbu", label: "Red–blue (diverging)" },
  { value: "rdylgn", label: "Red–yellow–green" },
  { value: "spectral", label: "Spectral" },
  { value: "custom", label: "Custom gradient…" },
];

function hex(c: number): string {
  return Math.round(Math.max(0, Math.min(255, c)))
    .toString(16)
    .padStart(2, "0");
}

/** Colour of a custom gradient at u in [0,1] (stops sorted by position). */
function customColorAt(stops: { t: number; color: string }[], u: number): string {
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  if (!sorted.length) return "#000000";
  if (u <= sorted[0].t) return sorted[0].color;
  if (u >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].color;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (u >= a.t && u <= b.t) {
      const f = b.t === a.t ? 0 : (u - a.t) / (b.t - a.t);
      const pa = parseHex(a.color);
      const pb = parseHex(b.color);
      return `#${hex(pa[0] + (pb[0] - pa[0]) * f)}${hex(pa[1] + (pb[1] - pa[1]) * f)}${hex(pa[2] + (pb[2] - pa[2]) * f)}`;
    }
  }
  return sorted[0].color;
}
function parseHex(c: string): Stop {
  const h = c.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0];
}
export const DEFAULT_CUSTOM_STOPS = [
  { t: 0, color: "#ffffff" },
  { t: 1, color: "#0072b2" },
];

/** Color for t in [0,1]. */
export function colorAt(name: ColormapName, t: number, reverse = false, custom?: { t: number; color: string }[]): string {
  let u = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  if (reverse) u = 1 - u;
  if (name === "custom") return customColorAt(custom?.length ? custom : DEFAULT_CUSTOM_STOPS, u);
  const stops = MAPS[name] ?? MAPS.viridis;
  const pos = u * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = stops[i];
  const b = stops[i + 1];
  return `#${hex(a[0] + (b[0] - a[0]) * f)}${hex(a[1] + (b[1] - a[1]) * f)}${hex(a[2] + (b[2] - a[2]) * f)}`;
}

export interface ColorMapper {
  (v: number): string;
  min: number;
  max: number;
  log: boolean;
  /** normalized position 0..1 of a value */
  t: (v: number) => number;
  /** number of discrete bands, 0 = continuous */
  discrete: number;
}

/** Build a value → color function from colormap options and the data range. */
export function makeColorMapper(opts: ColormapOptions, dataMin: number, dataMax: number): ColorMapper {
  let min = opts.min ?? dataMin;
  let max = opts.max ?? dataMax;
  if (!(Number.isFinite(min) && Number.isFinite(max))) {
    min = 0;
    max = 1;
  }
  if (max === min) max = min + 1;
  const log = opts.log && min > 0;
  const t = (v: number) => {
    if (!Number.isFinite(v)) return NaN;
    if (log) return (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
    return (v - min) / (max - min);
  };
  const n = opts.discrete && opts.discrete >= 2 ? Math.round(opts.discrete) : 0;
  // discrete bands: every value in a band gets the band's central colour
  const quant = (u: number) => (n ? (Math.min(n - 1, Math.max(0, Math.floor(u * n))) + 0.5) / n : u);
  const fn = ((v: number) => colorAt(opts.name, quant(t(v)), opts.reverse, opts.custom)) as ColorMapper;
  fn.min = min;
  fn.max = max;
  fn.log = log;
  fn.t = t;
  fn.discrete = n;
  return fn;
}
