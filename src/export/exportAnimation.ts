// Export of a figure's animation. Every frame is the same SVG the preview shows, rasterized at the chosen
// size, so the result is as sharp as a picture export. MP4 is encoded with the browser's own H.264 encoder
// (WebCodecs, through mediabunny), GIF with gifenc; both are loaded only when an export starts.
import type { Animation, Graph, Project } from "../model/types";
import { animationFrame, frameSchedule } from "../graph/animation";
import { layoutGraph, type GraphLayout } from "../graph/layout";
import { isTauri, joinPath, pickDirectory, pickSaveFile, writeBinary, downloadBlob } from "../io/platform";
import { drawSvgOnCanvas, layoutToSvg, safeName } from "./exportGraph";

export type AnimationFormat = "mp4" | "gif" | "png";

export interface AnimationExportOptions {
  format: AnimationFormat;
  /** width of the frames in pixels; the height follows the canvas */
  widthPx: number;
  /** GIF and PNG: no background */
  transparent: boolean;
  quality: "normal" | "high";
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Pixel size of the frames: the canvas aspect at the chosen width, both even (H.264 needs even sizes). */
export function animationFrameSize(layout: Pick<GraphLayout, "widthMm" | "heightMm">, widthPx: number): { width: number; height: number } {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const width = even(Math.min(7680, Math.max(16, widthPx)));
  return { width, height: even((width * layout.heightMm) / layout.widthMm) };
}

/** Delay of GIF frame i in ms. GIF delays are whole centiseconds, so they alternate to keep the total time right. */
export function gifDelayMs(i: number, fps: number, frames = 1): number {
  const at = (k: number) => Math.round((k * 100) / fps) * 10;
  return Math.max(20, at(i + frames) - at(i));
}

/** Target bitrate for H.264: line art compresses well, the higher setting keeps thin lines and text clean. */
export function videoBitrate(width: number, height: number, fps: number, quality: "normal" | "high"): number {
  return Math.round(Math.max(1.5e6, width * height * fps * (quality === "high" ? 0.25 : 0.12)));
}

/** Can this machine encode H.264 at this size? (Safari 16.4+ / macOS 13.3+, Chrome; false when WebCodecs is missing.) */
export async function canExportMp4(width: number, height: number, fps: number): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  try {
    const { canEncodeVideo } = await import("mediabunny");
    return await canEncodeVideo("avc", { width, height, bitrate: videoBitrate(width, height, fps, "normal") });
  } catch {
    return false;
  }
}

class Canceled extends Error {}

interface FrameSink {
  /** the canvas holds frame i; `repeat` = it is identical to the previous frame */
  add: (i: number, repeat: boolean) => Promise<void>;
  finish: () => Promise<void>;
  abort: () => Promise<void>;
}

/**
 * Render every frame and hand it to the sink. Frames that repeat the previous one (the pause at the end) are
 * not rendered again.
 */
async function renderFrames(layout: GraphLayout, anim: Animation, canvas: HTMLCanvasElement, background: string | null, sink: FrameSink, opts: AnimationExportOptions): Promise<number> {
  const sch = frameSchedule(anim);
  const ctx = canvas.getContext("2d", { willReadFrequently: opts.format === "gif" })!;
  let lastT = -1;
  try {
    for (let i = 0; i < sch.count; i++) {
      if (opts.signal?.aborted) throw new Canceled();
      const t = sch.tAt(i);
      const repeat = t === lastT;
      if (!repeat) {
        const svg = layoutToSvg(animationFrame(layout, anim, t), false);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        await drawSvgOnCanvas(svg, ctx, canvas.width, canvas.height);
        lastT = t;
      }
      await sink.add(i, repeat);
      opts.onProgress?.(i + 1, sch.count);
    }
    await sink.finish();
  } catch (e) {
    await sink.abort().catch(() => {});
    throw e;
  }
  return sch.count;
}

/** Encode the animation into a Blob (MP4 or GIF). */
export async function animationToBlob(project: Project, graph: Graph, opts: AnimationExportOptions): Promise<Blob> {
  const anim = graph.animation;
  if (!anim) throw new Error("This figure has no animation");
  const layout = layoutGraph(project, graph);
  const { width, height } = animationFrameSize(layout, opts.widthPx);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const fps = Math.max(1, anim.fps);
  const paper = graph.canvas.background && graph.canvas.background !== "transparent" ? graph.canvas.background : "#ffffff";

  if (opts.format === "mp4") {
    const { Output, Mp4OutputFormat, BufferTarget, CanvasSource } = await import("mediabunny");
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const source = new CanvasSource(canvas, { codec: "avc", bitrate: videoBitrate(width, height, fps, opts.quality), keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    await renderFrames(layout, anim, canvas, paper, { add: (i) => source.add(i / fps, 1 / fps), finish: () => output.finalize(), abort: () => output.cancel() }, opts);
    if (!target.buffer) throw new Error("The video encoder produced no data");
    return new Blob([target.buffer], { type: "video/mp4" });
  }

  if (opts.format === "gif") {
    const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
    const gif = GIFEncoder();
    const format = opts.transparent ? "rgba4444" : "rgb565";
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    // one palette for the whole animation, taken from the complete figure: steady colors and much faster
    const last = layoutToSvg(animationFrame(layout, anim, 1), false);
    if (!opts.transparent) {
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, width, height);
    }
    await drawSvgOnCanvas(last, ctx, width, height);
    // On an opaque background each frame stores only the pixels that differ from the frame before (the rest is
    // "transparent", i.e. kept): a curve that grows changes little per frame, so the file is several times smaller.
    // One palette entry is set aside for that. It repeats entry 0, and the nearest-color search may pick either
    // of two equal colors, so `frameIndex` maps it back to entry 0 before comparing.
    const delta = !opts.transparent;
    const palette = quantize(ctx.getImageData(0, 0, width, height).data, delta ? 255 : 256, { format, oneBitAlpha: opts.transparent });
    const keep = delta ? palette.push([...palette[0]]) - 1 : -1;
    const clear = opts.transparent ? palette.findIndex((c) => c.length > 3 && c[3] === 0) : -1;
    let shown: Uint8Array | null = null; // what the player has on screen after the frames written so far
    // consecutive identical frames become one frame that is shown longer
    let pending: { index: Uint8Array; first: number; frames: number } | null = null;
    let written = 0;
    const flush = () => {
      if (!pending) return;
      gif.writeFrame(pending.index, width, height, {
        palette: written === 0 ? palette : undefined,
        delay: gifDelayMs(pending.first, fps, pending.frames),
        repeat: anim.loop ? 0 : -1,
        transparent: delta ? written > 0 : clear >= 0,
        transparentIndex: delta ? keep : Math.max(0, clear),
        dispose: delta ? 1 : clear >= 0 ? 2 : -1,
      });
      written++;
      pending = null;
    };
    const frameIndex = (): Uint8Array => {
      const full = applyPalette(ctx.getImageData(0, 0, width, height).data, palette, format);
      if (!delta) return full;
      for (let k = 0; k < full.length; k++) if (full[k] === keep) full[k] = 0;
      const before = shown;
      shown = full;
      if (!before) return full;
      const diff = new Uint8Array(full.length);
      for (let k = 0; k < full.length; k++) diff[k] = full[k] === before[k] ? keep : full[k];
      return diff;
    };
    await renderFrames(
      layout,
      anim,
      canvas,
      opts.transparent ? null : paper,
      {
        add: async (i, repeat) => {
          if (repeat && pending) {
            pending.frames++;
            return;
          }
          flush();
          pending = { index: frameIndex(), first: i, frames: 1 };
        },
        finish: async () => {
          flush();
          gif.finish();
        },
        abort: async () => {},
      },
      opts,
    );
    return new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
  }
  throw new Error("Numbered pictures are written to a folder, not to one file");
}

const canvasPng = (canvas: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) => canvas.toBlob((b) => (b ? void b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error("Could not encode a frame"))), "image/png"));

/** Write the frames as numbered PNG files into a folder (desktop app). Returns the number of files. */
export async function animationToPngFolder(project: Project, graph: Graph, dir: string, opts: AnimationExportOptions): Promise<number> {
  const anim = graph.animation;
  if (!anim) throw new Error("This figure has no animation");
  const layout = layoutGraph(project, graph);
  const { width, height } = animationFrameSize(layout, opts.widthPx);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const paper = graph.canvas.background && graph.canvas.background !== "transparent" ? graph.canvas.background : "#ffffff";
  const base = joinPath(dir, `${safeName(graph.name)}_`);
  const digits = Math.max(4, String(frameSchedule(anim).count).length);
  let bytes: Uint8Array | null = null;
  return renderFrames(
    layout,
    anim,
    canvas,
    opts.transparent ? null : paper,
    {
      add: async (i, repeat) => {
        if (!repeat || !bytes) bytes = await canvasPng(canvas);
        await writeBinary(`${base}${String(i + 1).padStart(digits, "0")}.png`, bytes);
      },
      finish: async () => {},
      abort: async () => {},
    },
    opts,
  );
}

/**
 * Export a figure's animation: asks where to save first (desktop app), then renders. Returns what was saved,
 * or null when the user canceled.
 */
export async function exportAnimation(project: Project, graph: Graph, opts: AnimationExportOptions): Promise<string | null> {
  const name = safeName(graph.name);
  try {
    if (opts.format === "png") {
      const dir = await pickDirectory("Folder for the numbered pictures");
      if (!dir) return null;
      const n = await animationToPngFolder(project, graph, dir, opts);
      return `${n} pictures in ${dir.split(/[\\/]/).pop()}`;
    }
    const ext = opts.format;
    let path: string | null = null;
    if (isTauri()) {
      path = await pickSaveFile([{ name: ext === "mp4" ? "MP4 video" : "GIF", extensions: [ext] }], `${name}.${ext}`);
      if (!path) return null;
    }
    const blob = await animationToBlob(project, graph, opts);
    if (path) await writeBinary(path, new Uint8Array(await blob.arrayBuffer()));
    else downloadBlob(blob, `${name}.${ext}`);
    return path ? (path.split(/[\\/]/).pop() ?? path) : `${name}.${ext}`;
  } catch (e) {
    if (e instanceof Canceled) return null;
    throw e;
  }
}
