// Several projects at once: every project lives in its own native window ("main" plus "project-*"), each
// with its own store. Pop-out windows belong to a project window and carry its label ("<parent>--graph-<id>").
// This module knows which window is which, opens new project windows, and coordinates quitting.

import { isTauri } from "../io/platform";
import { useStore } from "../model/store";
import { useDialogs } from "./dialogs";
import { clearAutosave } from "../io/project";

let label: string | null = null;

/** Label of this window ("main" outside Tauri). */
export async function currentLabel(): Promise<string> {
  if (label) return label;
  if (!isTauri()) return (label = "main");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return (label = getCurrentWindow().label);
}

export function isProjectWindow(l: string): boolean {
  return !l.includes("--");
}

/** An untitled, unchanged, empty project: opening a file can simply replace it. */
export function isBlankProject(): boolean {
  const st = useStore.getState();
  if (st.dirty || st.filePath) return false;
  return st.project.graphs.length === 0 && !st.project.sheets.some((s) => s.columns.some((c) => c.values.length > 0 || c.formula));
}

/** Open a new project window; `open` loads a file there, `recover` loads an autosave file. */
export async function openProjectWindow(opts: { open?: string; recover?: string } = {}): Promise<void> {
  if (!isTauri()) {
    useDialogs.getState().showToast("Separate project windows are available in the Mac app");
    return;
  }
  const { WebviewWindow, getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { Effect, EffectState } = await import("@tauri-apps/api/window");
  const params = new URLSearchParams();
  if (opts.open) params.set("open", opts.open);
  if (opts.recover) params.set("recover", opts.recover);
  const q = params.toString();
  // cascade below/right of this window
  let x: number | undefined;
  let y: number | undefined;
  try {
    const cur = getCurrentWebviewWindow();
    const pos = await cur.outerPosition();
    const scale = await cur.scaleFactor();
    x = pos.x / scale + 28;
    y = pos.y / scale + 28;
  } catch {
    /* default placement */
  }
  const w = new WebviewWindow(`project-${Date.now().toString(36)}`, {
    url: `index.html${q ? `?${q}` : ""}`,
    title: "PlotFolio",
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 500,
    x,
    y,
    titleBarStyle: "overlay",
    hiddenTitle: true,
    transparent: true,
    windowEffects: { effects: [Effect.Sidebar], state: EffectState.Active },
  });
  void w.once("tauri://error", (e) => console.error("project window failed", e));
}

/** Label of the window that already shows this file, if any. */
export async function windowForFile(path: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke<string | null>("window_for_file", { path }).catch(() => null)) ?? null;
}

export async function focusWindow(l: string): Promise<boolean> {
  if (!isTauri()) return false;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const w = await WebviewWindow.getByLabel(l);
  if (!w) return false;
  await w.setFocus();
  return true;
}

/** Keep the Rust side informed of this window's file, so a file is never opened twice. */
export async function installWindowFileSync(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  let last: string | null | undefined;
  const push = (path: string | null) => {
    if (path === last) return;
    last = path;
    void invoke("set_window_file", { path });
  };
  push(useStore.getState().filePath);
  useStore.subscribe((s) => push(s.filePath));
}

/** Close this project window and its pop-outs (the autosave is dropped: nothing to recover). */
export async function closeThisWindow(): Promise<void> {
  if (!isTauri()) return;
  await clearAutosave();
  const { getAllWebviewWindows, getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const me = getCurrentWebviewWindow();
  for (const w of await getAllWebviewWindows()) if (w.label.startsWith(`${me.label}--`)) await w.destroy().catch(() => {});
  await me.destroy();
}

const EVT_QUIT = "plotkit:quit";

/** Quit: every project window closes itself, asking about its own unsaved changes; the app exits with the last one. */
export async function requestQuitAll(): Promise<void> {
  if (!isTauri()) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(EVT_QUIT, {});
}

export async function installQuitListener(): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen(EVT_QUIT, async () => {
    const l = await currentLabel();
    if (!isProjectWindow(l)) return; // pop-outs go with their project window
    if (!useStore.getState().dirty) {
      await closeThisWindow();
      return;
    }
    await focusWindow(l);
    useDialogs.getState().setClosePrompt({ mode: "quit" });
  });
}

// ---- clipboard shared between project windows --------------------------------------------------------

const EVT_CLIP = "plotkit:clipboard";
let applyingClip = false;

/** Layers and objects copied in one project window can be pasted in another. */
export async function installClipboardSync(): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { emit, listen } = await import("@tauri-apps/api/event");
  const me = await currentLabel();
  let lastL = useStore.getState().ui.layerClipboard;
  let lastO = useStore.getState().ui.objectClipboard;
  useStore.subscribe((s) => {
    if (applyingClip) return;
    if (s.ui.layerClipboard === lastL && s.ui.objectClipboard === lastO) return;
    lastL = s.ui.layerClipboard;
    lastO = s.ui.objectClipboard;
    void emit(EVT_CLIP, { origin: me, layers: lastL, objects: lastO });
  });
  return listen<{ origin: string; layers: typeof lastL; objects: typeof lastO }>(EVT_CLIP, (e) => {
    if (e.payload.origin === me) return;
    applyingClip = true;
    try {
      lastL = e.payload.layers;
      lastO = e.payload.objects;
      useStore.setState((s) => ({ ui: { ...s.ui, layerClipboard: lastL, objectClipboard: lastO } }));
    } finally {
      applyingClip = false;
    }
  });
}

/** Startup parameters of this window (a file to open, or an autosave to recover). */
export function windowStartParams(): { open?: string; recover?: string } {
  const p = new URLSearchParams(window.location.search);
  return { open: p.get("open") ?? undefined, recover: p.get("recover") ?? undefined };
}
