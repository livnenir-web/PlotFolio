import { useEffect, useState } from "react";
import type { Theme } from "@glideapps/glide-data-grid";
import { useAppearance } from "../app/appearance";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function computeGridTheme(): Partial<Theme> {
  const dark = useAppearance.getState().dark;
  return {
    accentColor: cssVar("--accent") || "#2b6fd6",
    accentLight: cssVar("--accent-bg") || "rgba(43,111,214,0.13)",
    textDark: cssVar("--text") || "#1d1d1f",
    textMedium: cssVar("--text-2") || "#6e6e73",
    textLight: cssVar("--text-3") || "#a8a8ad",
    textHeader: cssVar("--text-2") || "#6e6e73",
    textHeaderSelected: cssVar("--accent-text") || "#ffffff",
    bgCell: cssVar("--bg") || "#ffffff",
    bgCellMedium: cssVar("--bg-2") || "#f5f5f7",
    bgHeader: cssVar("--bg-2") || "#f5f5f7",
    bgHeaderHasFocus: cssVar("--bg-3") || "#ebebed",
    bgHeaderHovered: cssVar("--bg-3") || "#ebebed",
    bgIconHeader: cssVar("--text-2"),
    fgIconHeader: cssVar("--bg"),
    borderColor: dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.09)",
    horizontalBorderColor: dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
    bgBubble: cssVar("--bg-2"),
    bgBubbleSelected: cssVar("--accent-bg"),
    linkColor: cssVar("--accent"),
    cellHorizontalPadding: 6,
    cellVerticalPadding: 2,
    headerFontStyle: "600 11.5px",
    baseFontStyle: "12px",
    fontFamily: cssVar("--font") || "-apple-system, sans-serif",
    editorFontSize: "12px",
    lineHeight: 1.3,
  };
}

export function useGridTheme(): Partial<Theme> {
  // the colors come from the page's CSS variables: read them again whenever the appearance changes
  const dark = useAppearance((s) => s.dark);
  const accent = useAppearance((s) => s.accent);
  const [theme, setTheme] = useState<Partial<Theme>>(() => computeGridTheme());
  useEffect(() => setTheme(computeGridTheme()), [dark, accent]);
  return theme;
}
