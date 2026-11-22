// Playback position of the animation preview. Transient and per window: it is not part of the document, so
// playing or scrubbing never dirties the project, adds undo steps or reaches the pop-out windows.
import { create } from "zustand";
import { showInspectorTab } from "../ui/Fields";
import { defaultAnimation } from "../model/defaults";
import { useStore } from "../model/store";
import type { Animation, Graph } from "../model/types";
import { shownLayers } from "../model/figure";
import { frameSchedule, revealRange } from "./animation";
import { layoutGraph } from "./layout";

interface PlaybackState {
  /** graph the position belongs to */
  graphId: string | null;
  /** frame on screen; null = at rest, which shows the last frame (the complete figure) */
  frame: number | null;
  playing: boolean;
  /** jump to a frame (scrubbing): stops playback */
  seek: (graphId: string, frame: number) => void;
  /** advance during playback */
  setFrame: (graphId: string, frame: number) => void;
  play: (graphId: string) => void;
  pause: () => void;
  toggle: (graphId: string) => void;
  /** back to rest */
  reset: () => void;
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  graphId: null,
  frame: null,
  playing: false,
  seek: (graphId, frame) => set({ graphId, frame, playing: false }),
  setFrame: (graphId, frame) => set({ graphId, frame }),
  play: (graphId) => set((s) => ({ graphId, frame: s.graphId === graphId ? s.frame : null, playing: true })),
  pause: () => get().playing && set({ playing: false }),
  toggle: (graphId) => (get().playing && get().graphId === graphId ? get().pause() : get().play(graphId)),
  reset: () => set({ graphId: null, frame: null, playing: false }),
}));

/** Frame of a graph's animation that is on screen (the last one at rest). */
export function shownFrame(anim: Animation, frame: number | null): number {
  const last = frameSchedule(anim).count - 1;
  return frame === null ? last : Math.max(0, Math.min(last, Math.round(frame)));
}

/** Move the preview by whole frames, or to its first / last frame. */
export function stepFrame(graph: Graph, by: number | "first" | "last") {
  const anim = graph.animation;
  if (!anim) return;
  const st = usePlayback.getState();
  const last = frameSchedule(anim).count - 1;
  const cur = shownFrame(anim, st.graphId === graph.id ? st.frame : null);
  st.seek(graph.id, by === "first" ? 0 : by === "last" ? last : Math.max(0, Math.min(last, cur + by)));
}

/** The toolbar button and the menu command: switch the animation, and show its options when it comes on. */
export function toggleAnimationFromUi(graphId: string) {
  const st = useStore.getState();
  const was = !!st.project.graphs.find((g) => g.id === graphId)?.animation?.enabled;
  toggleAnimation(graphId);
  if (!was) {
    st.setSelection({ kind: "canvas", graphId });
    showInspectorTab("canvas", "animation");
  }
}

/**
 * Switch a figure's animation on or off. The first time, it gets an animation that suits it: a 3D figure turns,
 * a trajectory or a curve is revealed, and the windows start at a fifth of the x range.
 */
export function toggleAnimation(graphId: string, on?: boolean) {
  const st = useStore.getState();
  const graph = st.project.graphs.find((g) => g.id === graphId);
  if (!graph) return;
  if (graph.animation) {
    const next = on ?? !graph.animation.enabled;
    if (next !== graph.animation.enabled) st.updateGraph(graphId, (g) => void (g.animation!.enabled = next));
    if (!next) usePlayback.getState().reset();
    return;
  }
  if (on === false) return;
  const a = defaultAnimation();
  const layout = layoutGraph(st.project, graph);
  const view = shownLayers(graph).find((l) => l.view3d && l.axes.z)?.view3d;
  if (view) {
    a.rotate = { ...a.rotate, enabled: true, azimuthFrom: view.azimuth, azimuthTo: view.azimuth + 360, elevationFrom: view.elevation, elevationTo: view.elevation };
    a.reveal.enabled = shownLayers(graph).some((l) => l.plots.some((p) => p.visible && p.type === "scatter3d" && p.joinPoints));
  }
  for (const ll of layout.layers) {
    const r = revealRange(ll, { ...a.reveal, enabled: true });
    if (!r) continue;
    const w = Number(((r.to - r.from) / 5).toPrecision(2));
    if (w > 0) {
      a.reveal.followWindow = w;
      a.reveal.tail.window = w;
    }
    break;
  }
  st.updateGraph(graphId, (g) => void (g.animation = a));
  usePlayback.getState().reset();
}
