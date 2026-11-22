import type { ReactNode } from "react";

/** Small pictures of the plot kinds for the Plot Columns gallery (44 × 30, drawn in the current text color). */
const ICONS: Record<string, ReactNode> = {
  scatter: (
    <g fill="currentColor">
      <circle cx="7" cy="23" r="2.2" />
      <circle cx="14" cy="16" r="2.2" />
      <circle cx="21" cy="19" r="2.2" />
      <circle cx="28" cy="10" r="2.2" />
      <circle cx="37" cy="6" r="2.2" />
    </g>
  ),
  line: <path d="M4 24 14 13l9 6L40 5" />,
  lineScatter: (
    <>
      <path d="M4 24 14 13l9 6L40 5" />
      <g fill="currentColor" stroke="none">
        <circle cx="14" cy="13" r="2.4" />
        <circle cx="23" cy="19" r="2.4" />
        <circle cx="40" cy="5" r="2.4" />
        <circle cx="4" cy="24" r="2.4" />
      </g>
    </>
  ),
  bar: (
    <g fill="currentColor" stroke="none">
      <rect x="6" y="13" width="8" height="14" rx="1" />
      <rect x="18" y="5" width="8" height="22" rx="1" />
      <rect x="30" y="17" width="8" height="10" rx="1" />
    </g>
  ),
  histogram: (
    <g fill="currentColor" stroke="none">
      <rect x="4" y="19" width="7" height="8" />
      <rect x="11.5" y="10" width="7" height="17" />
      <rect x="19" y="4" width="7" height="23" />
      <rect x="26.5" y="13" width="7" height="14" />
      <rect x="34" y="22" width="6" height="5" />
    </g>
  ),
  cdf: <path d="M3 26h7v-5h6v-8h6V7h7V4h12" />,
  box: <path d="M9 10h10v11H9zM9 16h10M14 10V4M14 21v5M11 4h6M11 26h6M26 7h10v12H26zM26 12h10M31 7V3M31 19v6M28 3h6M28 25h6" />,
  violin: <path d="M14 3c0 7-7 8-7 13s7 4 7 11c0-7 7-6 7-11s-7-6-7-13zM31 5c0 5-6 7-6 10s6 5 6 11c0-6 6-8 6-11s-6-5-6-10z" />,
  points: (
    <>
      <g fill="currentColor" stroke="none">
        <circle cx="13" cy="6" r="1.7" />
        <circle cx="10" cy="12" r="1.7" />
        <circle cx="15.5" cy="13" r="1.7" />
        <circle cx="8" cy="18" r="1.7" />
        <circle cx="13" cy="19" r="1.7" />
        <circle cx="18" cy="17.5" r="1.7" />
        <circle cx="12" cy="25" r="1.7" />
        <circle cx="31" cy="4" r="1.7" />
        <circle cx="28" cy="9" r="1.7" />
        <circle cx="34" cy="10" r="1.7" />
        <circle cx="30.5" cy="14.5" r="1.7" />
        <circle cx="33" cy="20" r="1.7" />
      </g>
      <path d="M6 16h14M24 10h14" />
    </>
  ),
  heatmap: (
    <g fill="currentColor" stroke="none">
      {[0.25, 0.5, 0.8, 0.45, 0.6, 1, 0.7, 0.3, 0.35, 0.75, 0.5, 0.2].map((o, i) => (
        <rect key={i} x={5 + (i % 4) * 8.7} y={3 + Math.floor(i / 4) * 8.3} width="8" height="7.6" opacity={o} />
      ))}
    </g>
  ),
  contour: (
    <>
      <ellipse cx="21" cy="15" rx="17" ry="12" />
      <ellipse cx="19" cy="14" rx="11" ry="7.5" />
      <ellipse cx="17.5" cy="13.5" rx="5" ry="3.2" />
    </>
  ),
  surface3d: <path d="M4 21 17 9l10 5L40 4M4 21l11 6 25-10V4M17 9l-2 18M27 14l-2 9M10.5 15l11 6M23.5 6.5 34 11" />,
  scatter3d: (
    <>
      <path d="M20 14v13M20 14 5 22M20 14l19 7" opacity="0.55" />
      <g fill="currentColor" stroke="none">
        <circle cx="12" cy="9" r="2" />
        <circle cx="26" cy="6" r="2" />
        <circle cx="31" cy="14" r="2" />
        <circle cx="14" cy="20" r="2" />
        <circle cx="35" cy="24" r="2" />
      </g>
    </>
  ),
};

export function PlotKindIcon({ id }: { id: string }) {
  return (
    <svg width="44" height="30" viewBox="0 0 44 30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[id] ?? ICONS.scatter}
    </svg>
  );
}
