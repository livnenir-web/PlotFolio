import { useEffect, useState } from "react";
import type { Theme } from "@glideapps/glide-data-grid";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function computeGridTheme(): Partial<Theme> {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    accentColor: cssVar("--accent") || "#007aff",
    accentLight: cssVar("--accent-bg") || "rgba(0,122,255,0.14)",
    textDark: cssVar("--text") || "#1d1d1f",
    textMedium: cssVar("--text-2") || "#6e6e73",
    textLight: cssVar("--text-3") || "#a8a8ad",
    textHeader: cssVar("--text-2") || "#6e6e73",
    textHeaderSelected: "#ffffff",
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
  const [theme, setTheme] = useState<Partial<Theme>>(() => computeGridTheme());
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setTheme(computeGridTheme());
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return theme;
}
