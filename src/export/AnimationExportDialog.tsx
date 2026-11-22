import { useEffect, useRef, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { CheckField, NumberField, Row, Segmented } from "../ui/Fields";
import { useDialogs } from "../app/dialogs";
import { useStore } from "../model/store";
import { defaultAnimation } from "../model/defaults";
import { frameSchedule } from "../graph/animation";
import { layoutGraph } from "../graph/layout";
import { isTauri } from "../io/platform";
import { animationFrameSize, canExportMp4, exportAnimation, type AnimationFormat } from "./exportAnimation";

/** Save a figure's animation as an MP4 video, a GIF or numbered PNG pictures. */
export function AnimationExportDialog({ graphId }: { graphId: string }) {
  const project = useStore((s) => s.project);
  const graph = project.graphs.find((g) => g.id === graphId);
  const saved = graph?.animation?.export ?? defaultAnimation().export;
  const desktop = isTauri();
  const [format, setFormat] = useState<AnimationFormat>(saved.format === "png" && !desktop ? "mp4" : saved.format);
  const [widthPx, setWidthPx] = useState(saved.widthPx);
  const [transparent, setTransparent] = useState(saved.transparent);
  const [quality, setQuality] = useState(saved.quality);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [mp4Ok, setMp4Ok] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const busy = progress !== null;
  const close = () => {
    abort.current?.abort();
    useDialogs.getState().setAnimationExport(null);
  };

  const anim = graph?.animation;
  const layout = graph ? layoutGraph(project, graph) : null;
  const size = layout ? animationFrameSize(layout, widthPx) : { width: 0, height: 0 };
  const fps = anim?.fps ?? 30;
  useEffect(() => {
    let live = true;
    setMp4Ok(null);
    void canExportMp4(size.width, size.height, fps).then((ok) => live && setMp4Ok(ok));
    return () => {
      live = false;
    };
  }, [size.width, size.height, fps]);
  if (!graph || !anim || !layout) return null;
  const sch = frameSchedule(anim);
  const seconds = sch.count / Math.max(1, anim.fps);
  const dpi = Math.round(size.width / (layout.widthMm / 25.4));

  const run = async () => {
    setError(null);
    setProgress({ done: 0, total: sch.count });
    abort.current = new AbortController();
    // remember the choices with the figure
    useStore.getState().updateGraph(graphId, (g) => void (g.animation && (g.animation.export = { format, widthPx, transparent, quality })));
    try {
      const st = useStore.getState();
      const g = st.project.graphs.find((x) => x.id === graphId)!;
      const what = await exportAnimation(st.project, g, { format, widthPx, transparent, quality, signal: abort.current.signal, onProgress: (done, total) => setProgress({ done, total }) });
      if (what) {
        useDialogs.getState().showToast(`Saved ${what}`);
        useDialogs.getState().setAnimationExport(null);
        return;
      }
    } catch (e) {
      setError(`The export failed: ${(e as Error).message}`);
    }
    setProgress(null);
  };

  return (
    <Dialog
      title={`Export the animation of ${graph.name}`}
      info={
        format === "mp4"
          ? "H.264 video that plays in Keynote, PowerPoint and browsers. Every frame is drawn from the vector figure at this size, so lines and text stay sharp."
          : format === "gif"
            ? "A GIF plays everywhere but has 256 colors and grows quickly: 800 to 1280 px is usually enough. It loops when the animation does."
            : "One PNG per frame, numbered, in the folder you choose: for a video editor or ffmpeg."
      }
      onClose={close}
      width={480}
      actions={
        <>
          <button className="btn" onClick={close}>
            {busy ? "Stop" : "Cancel"}
          </button>
          <button className="btn primary" disabled={busy || (format === "mp4" && mp4Ok === false)} onClick={() => void run()}>
            {format === "png" ? "Choose folder…" : "Save…"}
          </button>
        </>
      }
    >
      <Row label="Format">
        <Segmented
          value={format}
          options={[{ value: "mp4" as AnimationFormat, label: "MP4 video" }, { value: "gif" as AnimationFormat, label: "GIF" }, ...(desktop ? [{ value: "png" as AnimationFormat, label: "PNG frames" }] : [])]}
          onChange={(v) => !busy && setFormat(v)}
        />
      </Row>
      <Row label="Width">
        <NumberField value={widthPx} min={64} max={7680} step={2} disabled={busy} onCommit={(v) => v >= 64 && setWidthPx(Math.min(7680, Math.round(v)))} style={{ width: 70 }} />
        <span className="hint">px</span>
        {[800, 1280, 1920, 3840].map((v) => (
          <button key={v} className={"btn small" + (v === widthPx ? " on" : "")} disabled={busy} onClick={() => setWidthPx(v)}>
            {v}
          </button>
        ))}
      </Row>
      <Row label="Frames">
        <span>
          {size.width} × {size.height} px
          <span className="hint">
            {" "}
            ({dpi} dpi) · {sch.count} frames · {Number(seconds.toFixed(2))} s at {anim.fps} frames/s
          </span>
        </span>
      </Row>
      {format === "mp4" && (
        <Row label="Quality">
          <Segmented
            value={quality}
            options={[
              { value: "normal", label: "Normal" },
              { value: "high", label: "High" },
            ]}
            onChange={(v) => !busy && setQuality(v)}
          />
        </Row>
      )}
      {format !== "mp4" && (
        <Row label="">
          <CheckField label="Transparent background" checked={transparent} onChange={setTransparent} disabled={busy} />
        </Row>
      )}
      {busy && (
        <div className="anim-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <div style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
          <span>
            Frame {progress.done} of {progress.total}
          </span>
        </div>
      )}
      {error && (
        <div className="note" style={{ color: "var(--danger)", marginTop: 8 }}>
          {error}
        </div>
      )}
      {format === "mp4" && mp4Ok === false && <div className="note">This system cannot encode H.264 video at this size. Try a smaller width, or export a GIF or PNG frames.</div>}
      {!(anim.reveal.enabled || anim.rotate.enabled || anim.buildUp.enabled) && <div className="note">Nothing is animated yet: switch an effect on in the Animation section first.</div>}
    </Dialog>
  );
}
