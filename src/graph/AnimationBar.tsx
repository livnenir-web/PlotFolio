import { useEffect, useMemo, useRef } from "react";
import type { Graph } from "../model/types";
import { useStore } from "../model/store";
import { useDialogs } from "../app/dialogs";
import { Icon } from "../ui/Icon";
import { showInspectorTab } from "../ui/Fields";
import { frameSchedule, playbackFrame } from "./animation";
import { shownFrame, usePlayback } from "./animationPlayback";
import { keyHintSuffix, useShortcuts } from "../app/shortcuts";

/** The timeline under an animated figure: play / pause, a scrubber over the frames, loop and export. It also runs the clock. */
export function AnimationBar({ graph }: { graph: Graph }) {
  const anim = graph.animation!;
  const sch = useMemo(() => frameSchedule(anim), [anim.durationS, anim.fps, anim.holdEndS]); // eslint-disable-line react-hooks/exhaustive-deps
  const stored = usePlayback((s) => (s.graphId === graph.id ? s.frame : null));
  const playing = usePlayback((s) => s.playing && s.graphId === graph.id);
  const overrides = useShortcuts((s) => s.overrides);
  const frame = shownFrame(anim, stored);
  const last = sch.count - 1;
  const animRef = useRef(anim);
  animRef.current = anim;

  // the clock: wall time decides the frame, so a slow frame is skipped rather than slowing the animation down
  useEffect(() => {
    if (!playing) return;
    const a0 = animRef.current;
    const n = frameSchedule(a0).count;
    const cur = usePlayback.getState().frame;
    const from = cur === null || cur >= n - 1 ? 0 : cur;
    const t0 = performance.now() - (from / Math.max(1, a0.fps)) * 1000;
    let raf = 0;
    const tick = () => {
      const { index, done } = playbackFrame((performance.now() - t0) / 1000, animRef.current);
      const st = usePlayback.getState();
      if (st.frame !== index) st.setFrame(graph.id, index);
      if (done) st.pause();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, graph.id, anim.durationS, anim.fps, anim.holdEndS, anim.loop]);

  // stop when the figure leaves the screen
  useEffect(() => {
    const hidden = () => document.hidden && usePlayback.getState().pause();
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      usePlayback.getState().pause();
    };
  }, []);

  const pb = usePlayback.getState;
  const fps = Math.max(1, anim.fps);
  const openOptions = () => {
    useStore.getState().setSelection({ kind: "canvas", graphId: graph.id });
    showInspectorTab("canvas", "animation");
  };
  return (
    <div className="anim-bar">
      <button className="icon-btn" title={`Back to the first frame${keyHintSuffix("animFirst", overrides)}`} onClick={() => pb().seek(graph.id, 0)}>
        <Icon name="skipBack" size={15} />
      </button>
      <button className="icon-btn anim-play" title={(playing ? "Pause" : "Play") + keyHintSuffix("playAnimation", overrides)} onClick={() => pb().toggle(graph.id)}>
        <Icon name={playing ? "pause" : "play"} size={16} />
      </button>
      <input
        className="anim-scrub"
        type="range"
        min={0}
        max={last}
        step={1}
        value={frame}
        title="Drag to move through the animation. Left and right arrows step one frame."
        onChange={(e) => pb().seek(graph.id, Number(e.target.value))}
      />
      <span className="anim-time" title="Time and frame on screen">
        {(Math.min(frame, sch.moving) / fps).toFixed(2)} / {(sch.moving / fps).toFixed(2)} s · frame {frame + 1} / {sch.count}
      </span>
      <button
        className={"icon-btn" + (anim.loop ? " on" : "")}
        title={anim.loop ? "Playing in a loop. Click to stop at the end instead." : "Stops at the end. Click to play in a loop."}
        onClick={() => useStore.getState().updateGraph(graph.id, (g) => void (g.animation!.loop = !g.animation!.loop))}
      >
        <Icon name="loop" size={15} />
      </button>
      <button className="btn small" title="Timing, what is animated and how the current point looks" onClick={openOptions}>
        Options
      </button>
      <button className="btn small" title="Save the animation as a video, a GIF or numbered pictures" onClick={() => useDialogs.getState().setAnimationExport({ graphId: graph.id })}>
        <Icon name="export" size={13} /> Export…
      </button>
    </div>
  );
}
