import { OKABE_ITO } from "./defaults";

/** Named colour palettes for plots, in cycle order. */
export interface Palette {
  id: string;
  name: string;
  colors: string[];
  /** short note shown under the picker */
  note?: string;
}

export const PALETTES: Palette[] = [
  { id: "okabe", name: "Okabe-Ito", colors: [...OKABE_ITO], note: "colour-blind safe, 8 colours" },
  { id: "tolBright", name: "Tol bright", colors: ["#4477AA", "#EE6677", "#228833", "#CCBB44", "#66CCEE", "#AA3377", "#BBBBBB"], note: "colour-blind safe, 7 colours" },
  { id: "tolMuted", name: "Tol muted", colors: ["#332288", "#88CCEE", "#44AA99", "#117733", "#999933", "#DDCC77", "#CC6677", "#882255", "#AA4499"], note: "colour-blind safe, 9 colours" },
  { id: "tolVibrant", name: "Tol vibrant", colors: ["#0077BB", "#33BBEE", "#009988", "#EE7733", "#CC3311", "#EE3377", "#BBBBBB"], note: "colour-blind safe, 7 colours" },
  { id: "tab10", name: "Tableau 10", colors: ["#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD", "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF"], note: "matplotlib default, 10 colours" },
  { id: "set1", name: "Set1", colors: ["#E41A1C", "#377EB8", "#4DAF4A", "#984EA3", "#FF7F00", "#A65628", "#F781BF", "#999999"], note: "ColorBrewer, strong, 8 colours" },
  { id: "dark2", name: "Dark2", colors: ["#1B9E77", "#D95F02", "#7570B3", "#E7298A", "#66A61E", "#E6AB02", "#A6761D", "#666666"], note: "ColorBrewer, darker, 8 colours" },
  { id: "paired", name: "Paired", colors: ["#1F78B4", "#A6CEE3", "#33A02C", "#B2DF8A", "#E31A1C", "#FB9A99", "#FF7F00", "#FDBF6F", "#6A3D9A", "#CAB2D6"], note: "light/dark pairs for before/after series" },
  { id: "origin", name: "Classic (Origin)", colors: ["#000000", "#FF0000", "#0000FF", "#FF00FF", "#008000", "#000080", "#800080", "#800000", "#008080", "#808000"], note: "the Origin default cycle" },
  { id: "viridis", name: "Viridis 8", colors: ["#440154", "#46327E", "#365C8D", "#277F8E", "#1FA187", "#4AC16D", "#A0DA39", "#FDE725"], note: "ordered: use for a series of conditions" },
  { id: "plasma", name: "Plasma 8", colors: ["#0D0887", "#5302A3", "#8B0AA5", "#B83289", "#DB5C68", "#F48849", "#FEBC2A", "#F0F921"], note: "ordered, warm" },
  { id: "blues", name: "Blues 6", colors: ["#08306B", "#08519C", "#2171B5", "#4292C6", "#6BAED6", "#9ECAE1"], note: "ordered, dark to light" },
  { id: "gray", name: "Grayscale", colors: ["#000000", "#404040", "#707070", "#9A9A9A", "#BDBDBD", "#DADADA"], note: "for print in black and white" },
];

/** The palette whose colours equal the given list, if any. */
export function paletteIdOf(colors: string[]): string | null {
  const key = colors.map((c) => c.toLowerCase()).join();
  return PALETTES.find((p) => p.colors.map((c) => c.toLowerCase()).join() === key)?.id ?? null;
}
