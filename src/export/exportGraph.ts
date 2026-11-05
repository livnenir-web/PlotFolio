import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Graph, Project } from "../model/types";
import { useStore } from "../model/store";
import { layoutGraph } from "../graph/layout";
import { GraphSvg } from "../graph/render/GraphSvg";
import { saveBinaryAs, saveTextAs } from "../io/platform";
import { useDialogs } from "../app/dialogs";

export interface RasterOptions {
  dpi: number;
  /** PNG only: transparent background instead of the canvas color. */
  transparent: boolean;
  jpegQuality: number;
}

/** Standalone SVG markup at physical size. No background (per user requirement), semantic groups. */
export function graphToSvg(project: Project, graph: Graph, background = false): string {
  const layout = layoutGraph(project, graph);
  const body = renderToStaticMarkup(createElement(GraphSvg, { layout, background }));
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${body.replace("<svg ", '<svg version="1.1" ')}`;
}

export function rasterSize(project: Project, graph: Graph, dpi: number): { width: number; height: number } {
  const layout = layoutGraph(project, graph);
  return { width: Math.round((layout.widthMm / 25.4) * dpi), height: Math.round((layout.heightMm / 25.4) * dpi) };
}

export async function graphToRaster(project: Project, graph: Graph, format: "png" | "jpeg", opts: RasterOptions): Promise<Blob> {
  const layout = layoutGraph(project, graph);
  const { width, height } = rasterSize(project, graph, opts.dpi);
  const svg = graphToSvg(project, graph, false);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    if (format === "jpeg" || !opts.transparent) {
      ctx.fillStyle = format === "jpeg" && graph.canvas.background === "transparent" ? "#ffffff" : graph.canvas.background || "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, width, height);
    void layout;
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), format === "png" ? "image/png" : "image/jpeg", opts.jpegQuality),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not render SVG"));
    img.src = url;
  });
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "-").trim() || "graph";
}

export type ExportTarget = "svg" | "png" | "jpeg" | "clipboard-svg" | "clipboard-png";

export async function exportGraphAs(graphId: string, target: ExportTarget, opts?: Partial<RasterOptions>): Promise<void> {
  const st = useStore.getState();
  const graph = st.project.graphs.find((g) => g.id === graphId);
  if (!graph) return;
  const d = st.project.defaults;
  const o: RasterOptions = { dpi: opts?.dpi ?? d.exportDpi, transparent: opts?.transparent ?? false, jpegQuality: opts?.jpegQuality ?? d.jpegQuality };
  const name = safeName(graph.name);
  const toast = useDialogs.getState().showToast;
  try {
    if (target === "svg") {
      const path = await saveTextAs(graphToSvg(st.project, graph), [{ name: "SVG", extensions: ["svg"] }], `${name}.svg`);
      if (path) toast(`Saved ${path.split("/").pop()}`);
    } else if (target === "png" || target === "jpeg") {
      const blob = await graphToRaster(st.project, graph, target, o);
      const ext = target === "png" ? "png" : "jpg";
      const path = await saveBinaryAs(blob, [{ name: target.toUpperCase(), extensions: [ext] }], `${name}.${ext}`);
      if (path) toast(`Saved ${path.split("/").pop()}`);
    } else if (target === "clipboard-svg") {
      await navigator.clipboard.writeText(graphToSvg(st.project, graph));
      toast("SVG copied to clipboard");
    } else if (target === "clipboard-png") {
      const blob = await graphToRaster(st.project, graph, "png", o);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("PNG copied to clipboard");
    }
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`);
  }
}
