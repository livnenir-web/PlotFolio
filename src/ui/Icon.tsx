import type { CSSProperties } from "react";

const PATHS: Record<string, string> = {
  sidebar: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 0v14h4V5H5zm6 0v14h8V5h-8z",
  inspector: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 0v14h8V5H5zm10 0v14h4V5h-4z",
  table: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 0v3h14V5H5zm0 5v4h4v-4H5zm6 0v4h8v-4h-8zm-6 6v3h4v-3H5zm6 0v3h8v-3h-8z",
  chart: "M4 3a1 1 0 0 1 1 1v15h15a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm14.3 4.3a1 1 0 0 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0L11 11.4l-3.3 3.3a1 1 0 0 1-1.4-1.4l4-4a1 1 0 0 1 1.4 0l2.3 2.3 4.3-4.3z",
  histogram: "M4 3a1 1 0 0 1 1 1v15h15a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm4 8h3v6H8v-6zm5-5h3v11h-3V6z",
  plus: "M12 5a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H6a1 1 0 1 1 0-2h5V6a1 1 0 0 1 1-1z",
  close: "M6.3 6.3a1 1 0 0 1 1.4 0l4.3 4.3 4.3-4.3a1 1 0 1 1 1.4 1.4L13.4 12l4.3 4.3a1 1 0 0 1-1.4 1.4L12 13.4l-4.3 4.3a1 1 0 0 1-1.4-1.4l4.3-4.3-4.3-4.3a1 1 0 0 1 0-1.4z",
  import: "M12 3a1 1 0 0 1 1 1v9.6l2.3-2.3a1 1 0 0 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L11 13.6V4a1 1 0 0 1 1-1zM5 17a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z",
  export: "M12 17a1 1 0 0 1-1-1V6.4L8.7 8.7a1 1 0 0 1-1.4-1.4l4-4a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1-1.4 1.4L13 6.4V16a1 1 0 0 1-1 1zM5 17a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z",
  fit: "M3 17.5c3-8 5-11 7-7s3 8 5 6 3-6 6-9.5",
  layer: "M12 3l9 5-9 5-9-5 9-5zm-7.2 9.6L12 16.8l7.2-4.2 1.8 1-9 5-9-5 1.8-1z",
  text: "M5 4h14v3h-2V6h-4v12h2v2H9v-2h2V6H7v1H5V4z",
  zoomIn: "M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a1 1 0 0 1 1 1v1h1a1 1 0 1 1 0 2h-1v1a1 1 0 1 1-2 0v-1H8a1 1 0 1 1 0-2h1V8a1 1 0 0 1 1-1zm5.3 8.9l4.4 4.4a1 1 0 0 1-1.4 1.4l-4.4-4.4 1.4-1.4z",
  zoomOut: "M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM8 9h4a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2zm7.3 6.9l4.4 4.4a1 1 0 0 1-1.4 1.4l-4.4-4.4 1.4-1.4z",
  zoomFit: "M4 4h5v2H6v3H4V4zm11 0h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z",
  undo: "M9.7 5.3a1 1 0 0 1 0 1.4L7.4 9H14a6 6 0 1 1 0 12h-3a1 1 0 1 1 0-2h3a4 4 0 0 0 0-8H7.4l2.3 2.3a1 1 0 0 1-1.4 1.4l-4-4a1 1 0 0 1 0-1.4l4-4a1 1 0 0 1 1.4 0z",
  redo: "M14.3 5.3a1 1 0 0 0 0 1.4L16.6 9H10a6 6 0 1 0 0 12h3a1 1 0 1 0 0-2h-3a4 4 0 0 1 0-8h6.6l-2.3 2.3a1 1 0 0 0 1.4 1.4l4-4a1 1 0 0 0 0-1.4l-4-4a1 1 0 0 0-1.4 0z",
  check: "M9 16.2l-3.5-3.5a1 1 0 1 0-1.4 1.4l4.2 4.2a1 1 0 0 0 1.4 0L20 8a1 1 0 1 0-1.4-1.4L9 16.2z",
  chevron: "M9 6l6 6-6 6",
  more: "M6 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  copy: "M8 3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8zm0 2h9v10H8V5zM4 8a1 1 0 0 1 1 1v10h10a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z",
  trash: "M9 3a1 1 0 0 0-1 1v1H4a1 1 0 1 0 0 2h1v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7h1a1 1 0 1 0 0-2h-4V4a1 1 0 0 0-1-1H9zm1 2h4v0h-4zM7 7h10v12H7V7zm2 2v8h2V9H9zm4 0v8h2V9h-2z",
  axis: "M5 3a1 1 0 0 1 1 1v14h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm0 4a1 1 0 0 1 1 1v1h2a1 1 0 1 1 0 2H6v2a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1zm10 10h-2v2h2v-2zm-4 0H9v2h2v-2z",
  legend: "M4 6a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm6-1h10a1 1 0 1 1 0 2H10a1 1 0 1 1 0-2zM4 12a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm6-1h10a1 1 0 1 1 0 2H10a1 1 0 1 1 0-2zm-6 7a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm6-1h10a1 1 0 1 1 0 2H10a1 1 0 1 1 0-2z",
  sigma: "M6 4h12v3h-2V6H9.2l4.2 5.3a1 1 0 0 1 0 1.3L9.2 18H16v-1h2v3H6v-1.6l5.3-6.4L6 5.6V4z",
  warning: "M12 3l10 18H2L12 3zm0 4.5L5.4 19h13.2L12 7.5zM11 10h2v5h-2v-5zm0 6h2v2h-2v-2z",
  folder: "M3 6a2 2 0 0 1 2-2h4.6a2 2 0 0 1 1.4.6L12.4 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6zm2 0v11h14V8h-7.4l-2-2H5z",
  folderPlus: "M3 6a2 2 0 0 1 2-2h4.6a2 2 0 0 1 1.4.6L12.4 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6zm2 0v11h14V8h-7.4l-2-2H5zm6 4h2v2h2v2h-2v2h-2v-2H9v-2h2v-2z",
  cube: "M12 2l9 5v10l-9 5-9-5V7l9-5zm0 2.3L5.3 8 12 11.7 18.7 8 12 4.3zM5 9.7v6.1l6 3.3v-6.1l-6-3.3zm14 0l-6 3.3v6.1l6-3.3V9.7z",
  alignLeft: "M4 3a1 1 0 0 1 1 1v16a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1zm3 4h12v4H7V7zm0 6h8v4H7v-4z",
  alignCenterH: "M12 3a1 1 0 0 1 1 1v2h5v4h-5v2h3v4h-3v4a1 1 0 1 1-2 0v-4H8v-4h3v-2H6V6h5V4a1 1 0 0 1 1-1z",
  alignRight: "M20 3a1 1 0 0 1 1 1v16a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1zM5 7h12v4H5V7zm4 6h8v4H9v-4z",
  alignTop: "M3 4a1 1 0 0 1 1-1h16a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1zm4 3h4v12H7V7zm6 0h4v8h-4V7z",
  alignCenterV: "M3 12a1 1 0 0 1 1-1h2V6h4v5h2V8h4v3h4a1 1 0 1 1 0 2h-4v3h-4v-3h-2v5H6v-5H4a1 1 0 0 1-1-1z",
  alignBottom: "M3 20a1 1 0 0 1 1-1h16a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1zM7 5h4v12H7V5zm6 4h4v8h-4V9z",
  distributeH: "M3 4a1 1 0 0 1 1 1v14a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1zm18 0a1 1 0 0 1 1 1v14a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1zM8 8h3v8H8V8zm5 0h3v8h-3V8z",
  distributeV: "M4 3a1 1 0 0 1 1 1 1 1 0 0 1-1 1H4a1 1 0 0 1 0-2zm0 0h16a1 1 0 1 1 0 2H4a1 1 0 1 1 0-2zm0 16h16a1 1 0 1 1 0 2H4a1 1 0 1 1 0-2zM8 8h8v3H8V8zm0 5h8v3H8v-3z",
  image: "M5 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5zm0 2h14v8.6l-3.3-3.3a1 1 0 0 0-1.4 0L10 15.6l-1.8-1.8a1 1 0 0 0-1.4 0L5 15.6V6zm0 12v-.6l2.5-2.5 1.8 1.8a1 1 0 0 0 1.4 0l4.3-4.3 4 4V18H5zm4-9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
  popout: "M5 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 1 0-2 0v5H5V6h5a1 1 0 1 0 0-2H5zm9 0a1 1 0 1 0 0 2h3.6l-7.3 7.3a1 1 0 0 0 1.4 1.4L19 7.4V11a1 1 0 1 0 2 0V5a1 1 0 0 0-1-1h-6z",
  grip: "M9 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm10-14a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  shapes: "M4 4h7v7H4V4zm2 2v3h3V6H6zm10.5-2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3 20l5-8 5 8H3zm3.6-2h2.8L8 15.7 6.6 18zM14 13h7v7h-7v-7zm2 2v3h3v-3h-3z",
  functionF: "M13.5 3a3 3 0 0 0-3 3v2H8v2h2.5v8.5a1 1 0 0 1-1 1H8v2h1.5a3 3 0 0 0 3-3V10H15V8h-2.5V6a1 1 0 0 1 1-1H15V3h-1.5z",
  analysis: "M4 4a1 1 0 0 1 1 1v13h14a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm13.5 2.6a1 1 0 0 1 .9 1.4l-3 7a1 1 0 0 1-1.8.1l-1.9-3.8-2.3 4.7a1 1 0 0 1-1.8-.9l3.2-6.4a1 1 0 0 1 1.8 0l1.9 3.8 2.1-5a1 1 0 0 1 .9-.6z",
};

export function Icon({ name, size = 16, style, className }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  const d = PATHS[name];
  const stroke = name === "fit" || name === "chevron";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={stroke ? "none" : "currentColor"}
      stroke={stroke ? "currentColor" : "none"}
      strokeWidth={stroke ? 2 : 0}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
