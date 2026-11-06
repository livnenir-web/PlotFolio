// Opening a project from Finder (double-click or drag onto the Dock icon). macOS hands the path to the
// Rust side, which queues it (the webview may still be loading) and emits "open-file" for running windows.

import { isTauri } from "../io/platform";
import { useStore } from "../model/store";
import { useDialogs } from "./dialogs";
import { openProject } from "../io/project";
import { guardedOpen } from "./menu";
import { windowStartParams } from "./windows";

let handled = new Set<string>();

/** Open a project file queued before the app was ready. Returns true when one was opened. */
export async function openPendingFile(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  const paths = await invoke<string[]>("take_pending_open").catch(() => [] as string[]);
  const p = paths.find((x) => x.toLowerCase().endsWith(".plotproj"));
  if (!p) return false;
  handled.add(p);
  try {
    return await openProject(p);
  } catch (e) {
    useDialogs.getState().showToast(`Could not open: ${(e as Error).message}`);
    return false;
  }
}

/** While running: a double-clicked project opens in its own window (or comes to the front if already open). */
export async function installOpenFileListener(): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string[]>("open-file", (e) => {
    const p = e.payload.find((x) => x.toLowerCase().endsWith(".plotproj"));
    if (!p) return;
    // the launch path is also queued and opened by openPendingFile; skip the duplicate event
    if (handled.has(p) && useStore.getState().filePath === p) {
      handled.delete(p);
      return;
    }
    void guardedOpen(p);
  });
}

/**
 * In the browser: load a project from a URL (same origin, or one that allows cross-origin requests), e.g. a sample
 * hosted next to the app. The project opens untitled, so "Save" downloads a copy instead of overwriting anything.
 */
export async function openProjectFromUrl(url: string, name?: string): Promise<boolean> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const { deserializeProjectFile } = await import("../io/project");
  const { project, view } = deserializeProjectFile(await res.text());
  if (name) project.name = name;
  useStore.getState().loadProject(project, null, view);
  return true;
}

/** Open a bundled sample, asking first when the current project has unsaved changes. */
export async function loadSample(file: string, name: string): Promise<void> {
  const { confirmDialog } = await import("../ui/confirm");
  if (useStore.getState().dirty && !(await confirmDialog("Discard your changes and open the sample?"))) return;
  try {
    await openProjectFromUrl(`samples/${file}`, name);
  } catch (e) {
    useDialogs.getState().showToast(`Could not load the sample: ${(e as Error).message}`);
  }
}

/** Bundled samples (public/samples/index.json), for the browser build. */
export async function listSamples(): Promise<{ file: string; name: string }[]> {
  try {
    const res = await fetch("samples/index.json", { cache: "no-cache" });
    return res.ok ? ((await res.json()) as { file: string; name: string }[]) : [];
  } catch {
    return [];
  }
}

/** A window started with ?open= or ?recover= loads that project before anything else (browser: ?project= or ?sample=). */
export async function openStartupProject(): Promise<boolean> {
  if (!isTauri()) {
    const q = new URLSearchParams(window.location.search);
    const sample = q.get("sample");
    const url = q.get("project") ?? (sample ? `samples/${sample}${sample.endsWith(".plotproj") ? "" : ".plotproj"}` : null);
    if (!url) return false;
    try {
      const samples = sample ? await listSamples() : [];
      return await openProjectFromUrl(url, samples.find((x) => x.file === sample || x.file === `${sample}.plotproj`)?.name);
    } catch (e) {
      useDialogs.getState().showToast(`Could not load the project: ${(e as Error).message}`);
      return false;
    }
  }
  const { open, recover } = windowStartParams();
  if (open) {
    try {
      return await openProject(open);
    } catch (e) {
      useDialogs.getState().showToast(`Could not open: ${(e as Error).message}`);
      return false;
    }
  }
  if (recover) {
    const { readText } = await import("../io/platform");
    const { deserializeProjectFile } = await import("../io/project");
    try {
      const { project: p, view } = deserializeProjectFile(await readText(recover));
      useStore.getState().loadProject(p, null, view);
      useStore.setState({ savedRef: null, dirty: true });
      const { remove } = await import("@tauri-apps/plugin-fs");
      await remove(recover).catch(() => {});
      return true;
    } catch (e) {
      useDialogs.getState().showToast(`Could not recover: ${(e as Error).message}`);
    }
  }
  return false;
}
