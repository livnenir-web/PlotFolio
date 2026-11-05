// Embedded pictures: reading image files (file picker, drop, clipboard) into data URLs and placing them
// on a graph as "image" shapes, so they move, resize, align, copy and export like any drawn object.

import { useStore } from "../model/store";
import { layoutGraph } from "../graph/layout";
import { useDialogs } from "../app/dialogs";
import { browserPickFiles, isTauri, pickOpenFile, readBinary } from "./platform";

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"];
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp" };
/** Pictures larger than this (long side, px) are downscaled before being stored in the project. */
const MAX_SIDE = 2400;

export function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.includes(ext);
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("Could not read the image"));
    r.readAsDataURL(file);
  });
}

export async function pathToDataUrl(path: string): Promise<string> {
  const bytes = await readBinary(path);
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext] ?? "application/octet-stream";
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(bin)}`;
}

export function loadImageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || img.width || 100, h: img.naturalHeight || img.height || 100 });
    img.onerror = () => reject(new Error("Not a supported image"));
    img.src = dataUrl;
  });
}

/** Downscale very large rasters so the project file stays small; SVG is kept as is. */
async function normalize(dataUrl: string): Promise<{ href: string; w: number; h: number }> {
  const { w, h } = await loadImageSize(dataUrl);
  const long = Math.max(w, h);
  if (dataUrl.startsWith("data:image/svg") || long <= MAX_SIDE || typeof document === "undefined") return { href: dataUrl, w, h };
  const k = MAX_SIDE / long;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { href: dataUrl, w, h };
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("Could not decode the image"));
    img.src = dataUrl;
  });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpeg = dataUrl.startsWith("data:image/jpeg");
  return { href: canvas.toDataURL(jpeg ? "image/jpeg" : "image/png", 0.92), w: canvas.width, h: canvas.height };
}

/** Let the user choose an image file; returns its data URL and name, or null when cancelled. */
export async function pickImageFile(): Promise<{ dataUrl: string; name: string } | null> {
  if (isTauri()) {
    const res = await pickOpenFile([{ name: "Images", extensions: IMAGE_EXTS }]);
    if (!res?.[0]) return null;
    return { dataUrl: await pathToDataUrl(res[0]), name: res[0].split("/").pop() ?? "Image" };
  }
  const files = await browserPickFiles(IMAGE_EXTS.map((e) => "." + e).join(","));
  if (!files[0]) return null;
  return { dataUrl: await fileToDataUrl(files[0]), name: files[0].name };
}

export interface InsertImageOptions {
  layerId?: string;
  /** centre of the picture in canvas mm; default: the centre of the layer's data area */
  at?: { x: number; y: number };
  name?: string;
  /** width in mm; default: natural size at 96 dpi, capped to 60 % of the data area */
  widthMm?: number;
}

/** Place a picture on a graph as an image shape and select it. Returns the shape id. */
export async function insertImageIntoGraph(graphId: string, dataUrl: string, opts: InsertImageOptions = {}): Promise<string | null> {
  const st = useStore.getState();
  const graph = st.project.graphs.find((g) => g.id === graphId);
  if (!graph) return null;
  let norm: { href: string; w: number; h: number };
  try {
    norm = await normalize(dataUrl);
  } catch (e) {
    useDialogs.getState().showToast((e as Error).message);
    return null;
  }
  const layerId = (opts.layerId && graph.layers.some((l) => l.id === opts.layerId) ? opts.layerId : undefined) ?? graph.layers[0]?.id ?? useStore.getState().addLayer(graphId);
  const layout = layoutGraph(useStore.getState().project, useStore.getState().project.graphs.find((g) => g.id === graphId)!);
  const ll = layout.layers.find((x) => x.layer.id === layerId);
  const f = ll?.layer.frame ?? { xMm: 20, yMm: 5, wMm: 50, hMm: 50 };
  const pxPerMm = 96 / 25.4;
  const w = opts.widthMm ?? Math.min(norm.w / pxPerMm, f.wMm * 0.6);
  const h = (w * norm.h) / norm.w;
  const c = opts.at ?? { x: f.xMm + f.wMm / 2, y: f.yMm + f.hMm / 2 };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const id = useStore.getState().addShape(graphId, layerId, "image", r1(c.x - w / 2), r1(c.y - h / 2), r1(c.x + w / 2), r1(c.y + h / 2), {
    href: norm.href,
    naturalW: norm.w,
    naturalH: norm.h,
    opacity: 1,
    lockAspect: true,
    name: opts.name,
  });
  useStore.getState().setSelection({ kind: "shape", graphId, layerId, shapeId: id });
  return id;
}
