// Pop a graph or sheet out into its own native window (second screen). The main window owns the
// project; pop-out windows mirror it through Tauri events and send their edits back.

import { useStore } from "../model/store";
import type { Project, TabRef } from "../model/types";
import { isTauri } from "../io/platform";

const EVT_PROJECT = "plotkit:project";
const EVT_REQUEST = "plotkit:request-project";

export function popoutTarget(): TabRef | null {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("view");
  const id = params.get("id");
  if ((kind === "graph" || kind === "sheet") && id) return { kind, id };
  return null;
}

export async function popOutActiveTab(): Promise<void> {
  const tab = useStore.getState().ui.activeTab;
  if (tab) await popOutTab(tab);
}

/** Labels of the pop-out windows that are open (project changes are sent only to these). */
const popouts = new Set<string>();
const SYNC_DELAY_MS = 50;

/** Open a sheet or graph in its own native window (focuses it when already open). */
export async function popOutTab(tab: TabRef): Promise<void> {
  if (!isTauri()) {
    const { useDialogs } = await import("./dialogs");
    useDialogs.getState().showToast("Separate windows are available in the Mac app");
    return;
  }
  const { WebviewWindow, getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const parent = getCurrentWebviewWindow().label;
  const label = `${parent}--${tab.kind}-${tab.id}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const name = tab.kind === "graph" ? useStore.getState().project.graphs.find((g) => g.id === tab.id)?.name : useStore.getState().project.sheets.find((s) => s.id === tab.id)?.name;
  const w = new WebviewWindow(label, {
    url: `index.html?view=${tab.kind}&id=${encodeURIComponent(tab.id)}&parent=${encodeURIComponent(parent)}`,
    title: name ?? "PlotFolio",
    width: 900,
    height: 650,
    minWidth: 500,
    minHeight: 400,
    titleBarStyle: "overlay",
    hiddenTitle: true,
  });
  popouts.add(label);
  void w.once("tauri://destroyed", () => popouts.delete(label));
  void w.once("tauri://error", (e) => {
    popouts.delete(label);
    console.error("popout failed", e);
  });
}

let applyingRemote = false;

/** A drag that writes the store per frame pauses undo tracking; the mirror waits for it to finish. */
function dragInProgress(): boolean {
  return !useStore.temporal.getState().isTracking;
}

/**
 * Trailing throttle: the project is serialised over IPC at most every SYNC_DELAY_MS, and the last state
 * after a burst of edits is always sent.
 */
function makeThrottle(send: () => void): () => void {
  let timer: number | null = null;
  const fire = () => {
    timer = null;
    if (dragInProgress()) {
      timer = window.setTimeout(fire, SYNC_DELAY_MS);
      return;
    }
    send();
  };
  return () => {
    if (timer === null) timer = window.setTimeout(fire, SYNC_DELAY_MS);
  };
}

/** Main window: send project changes to open pop-outs and answer their requests. */
export async function installMainSync(): Promise<void> {
  if (!isTauri()) return;
  const { emitTo, listen } = await import("@tauri-apps/api/event");
  // pop-outs of this window that already exist (e.g. after a reload)
  try {
    const { getAllWebviewWindows, getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const me = getCurrentWebviewWindow().label;
    for (const w of await getAllWebviewWindows()) if (w.label.startsWith(`${me}--`)) popouts.add(w.label);
  } catch {
    /* ignore */
  }
  let last = useStore.getState().project;
  const sendTo = (label: string, project: Project) => void emitTo(label, EVT_PROJECT, { project, origin: "main" }).catch(() => popouts.delete(label));
  const schedule = makeThrottle(() => {
    const project = useStore.getState().project;
    if (project === last) return;
    last = project;
    for (const label of popouts) sendTo(label, project);
  });
  useStore.subscribe((s) => {
    if (s.project === last || applyingRemote) return;
    if (popouts.size === 0) {
      last = s.project; // nobody to tell: no serialisation at all
      return;
    }
    schedule();
  });
  await listen<{ label?: string }>(EVT_REQUEST, (e) => {
    const label = e.payload?.label;
    if (!label) return;
    popouts.add(label);
    last = useStore.getState().project;
    sendTo(label, last);
  });
  await listen<{ project: Project; origin: string }>(EVT_PROJECT, (e) => {
    if (e.payload.origin === "main") return;
    applyingRemote = true;
    try {
      last = e.payload.project;
      useStore.setState({ project: e.payload.project, dirty: true });
    } finally {
      applyingRemote = false;
    }
  });
}

/** Pop-out window: mirror its project window and push local edits back (throttled the same way). */
export async function installPopoutSync(label: string): Promise<void> {
  if (!isTauri()) return;
  const { emitTo, listen } = await import("@tauri-apps/api/event");
  const parent = new URLSearchParams(window.location.search).get("parent") ?? label.split("--")[0] ?? "main";
  let last = useStore.getState().project;
  await listen<{ project: Project; origin: string }>(EVT_PROJECT, (e) => {
    if (e.payload.origin === label) return;
    applyingRemote = true;
    try {
      last = e.payload.project;
      useStore.setState({ project: e.payload.project });
    } finally {
      applyingRemote = false;
    }
  });
  const schedule = makeThrottle(() => {
    const project = useStore.getState().project;
    if (project === last) return;
    last = project;
    void emitTo(parent, EVT_PROJECT, { project, origin: label });
  });
  useStore.subscribe((s) => {
    if (s.project === last || applyingRemote) return;
    schedule();
  });
  await emitTo(parent, EVT_REQUEST, { label });
}
