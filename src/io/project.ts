import type { Project, ProjectView } from "../model/types";
import { PROJECT_VERSION, defaultGraphDefaults } from "../model/defaults";
import { useStore } from "../model/store";
import { addRecent, removeRecent } from "./recent";
import {
  appDataDir,
  baseName,
  browserPickFiles,
  ensureDir,
  isTauri,
  pickOpenFile,
  pickSaveFile,
  readText,
  saveTextAs,
  setWindowTitle,
  stripExt,
  writeText,
} from "./platform";

export const PROJECT_FILTER = [{ name: "PlotFolio project", extensions: ["plotproj"] }];

/** The project plus the current view (tabs, zoom, folder), so it reopens where it was left. */
export function serializeProject(p: Project, view: ProjectView | null = useStore.getState().captureView()): string {
  return JSON.stringify({ ...p, version: PROJECT_VERSION, view: view ?? undefined }, null, 0);
}

export function deserializeProject(text: string): Project {
  return deserializeProjectFile(text).project;
}

export function deserializeProjectFile(text: string): { project: Project; view: ProjectView | null } {
  const raw = JSON.parse(text) as Partial<Project> & { view?: ProjectView };
  const view = raw.view && Array.isArray(raw.view.openTabs) ? { openTabs: raw.view.openTabs, activeTab: raw.view.activeTab ?? null, zoom: raw.view.zoom ?? {}, currentFolderId: raw.view.currentFolderId ?? null } : null;
  return { project: parseProject(raw), view };
}

function parseProject(raw: Partial<Project>): Project {
  if (!raw || !Array.isArray(raw.sheets) || !Array.isArray(raw.graphs)) throw new Error("Not a PlotFolio project file");
  const defaults = { ...defaultGraphDefaults(), ...(raw.defaults ?? {}) };
  // older files: log10 axes had no minor-tick control; keep their classic 2…9 marks
  for (const g of raw.graphs) for (const l of g.layers ?? []) for (const a of Object.values(l.axes ?? {})) if (a && a.scale === "log" && a.minorCount === 1) a.minorCount = 8;
  return {
    id: raw.id ?? "project",
    name: raw.name ?? "Untitled",
    version: PROJECT_VERSION,
    sheets: raw.sheets,
    graphs: raw.graphs,
    folders: Array.isArray(raw.folders) ? raw.folders : [],
    defaults,
  };
}

export async function saveProject(as = false): Promise<boolean> {
  const st = useStore.getState();
  const text = serializeProject(st.project);
  let path = st.filePath;
  if (as || !path) {
    if (!isTauri()) {
      await saveTextAs(text, PROJECT_FILTER, `${st.project.name}.plotproj`);
      return true;
    }
    path = await pickSaveFile(PROJECT_FILTER, `${st.project.name}.plotproj`);
    if (!path) return false;
  }
  await writeText(path, text);
  const name = stripExt(baseName(path));
  if (useStore.getState().project.name !== name) useStore.getState().setProjectName(name);
  useStore.getState().markSaved(path);
  addRecent(path);
  void clearAutosave(); // the saved file is now the source of truth
  void updateTitle();
  return true;
}

export async function openProject(path?: string): Promise<boolean> {
  if (!isTauri()) {
    const files = await browserPickFiles(".plotproj,.json");
    if (!files[0]) return false;
    const p = deserializeProject(await files[0].text());
    useStore.getState().loadProject(p, null);
    void updateTitle();
    return true;
  }
  let target = path;
  if (!target) {
    const res = await pickOpenFile(PROJECT_FILTER);
    if (!res) return false;
    target = res[0];
  }
  let text: string;
  try {
    text = await readText(target);
  } catch (e) {
    removeRecent(target);
    throw e;
  }
  const { project: p, view } = deserializeProjectFile(text);
  p.name = stripExt(baseName(target));
  // the view last seen on this machine wins over the one stored in the file
  useStore.getState().loadProject(p, target, (await loadViewSidecar(target)) ?? view);
  addRecent(target);
  void updateTitle();
  return true;
}

// ---- last view per file (local, independent of saving) ----------------------------------------------

const VIEWS_KEY = "plotkit.views";
async function viewsPath(): Promise<string | null> {
  const dir = await appDataDir();
  if (!dir) return null;
  await ensureDir(dir);
  return `${dir}/views.json`;
}
async function readViews(): Promise<Record<string, ProjectView>> {
  try {
    if (isTauri()) {
      const p = await viewsPath();
      if (!p) return {};
      const { exists } = await import("@tauri-apps/plugin-fs");
      if (!(await exists(p))) return {};
      return JSON.parse(await readText(p));
    }
    return JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "{}");
  } catch {
    return {};
  }
}
async function loadViewSidecar(path: string): Promise<ProjectView | null> {
  return (await readViews())[path] ?? null;
}
let viewTimer: number | null = null;
/** Remember the view of the current file (debounced); called whenever tabs, zoom or folder change. */
export function rememberView(): void {
  const path = useStore.getState().filePath;
  if (!path) return;
  if (viewTimer) window.clearTimeout(viewTimer);
  viewTimer = window.setTimeout(() => void writeView(path, useStore.getState().captureView()), 800);
}
async function writeView(path: string, view: ProjectView): Promise<void> {
  try {
    const all = await readViews();
    all[path] = view;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete all[k]; // keep the file small
    if (isTauri()) {
      const p = await viewsPath();
      if (p) await writeText(p, JSON.stringify(all));
    } else localStorage.setItem(VIEWS_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn("view sidecar", e);
  }
}
/** Subscribe once: the view is remembered as it changes. */
export function installViewMemory(): void {
  let last = useStore.getState().captureView();
  useStore.subscribe((s) => {
    const v = s.ui;
    if (v.openTabs === last.openTabs && v.activeTab === last.activeTab && v.zoom === last.zoom && v.currentFolderId === last.currentFolderId) return;
    last = { openTabs: v.openTabs, activeTab: v.activeTab, zoom: v.zoom, currentFolderId: v.currentFolderId };
    rememberView();
  });
}

export async function updateTitle() {
  const st = useStore.getState();
  await setWindowTitle(`${st.project.name}${st.dirty ? " — Edited" : ""}`);
}

// ---- autosave / recovery -------------------------------------------------

const AUTOSAVE_KEY = "plotkit.autosave";
let autosaveTimer: number | null = null;

/** Each project window autosaves to its own file ("main" keeps the historical name). */
async function autosavePath(): Promise<string | null> {
  const dir = await appDataDir();
  if (!dir) return null;
  await ensureDir(dir);
  const { currentLabel } = await import("../app/windows");
  const label = await currentLabel();
  return label === "main" ? `${dir}/autosave.plotproj` : `${dir}/autosave-${label}.plotproj`;
}

/** Autosave files of other windows from the last session (for recovery in new windows). */
export async function otherAutosaves(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    const dir = await appDataDir();
    if (!dir) return [];
    const { readDir } = await import("@tauri-apps/plugin-fs");
    const own = await autosavePath();
    return (await readDir(dir))
      .filter((e) => e.isFile && /^autosave-.*\.plotproj$/.test(e.name))
      .map((e) => `${dir}/${e.name}`)
      .filter((p) => p !== own);
  } catch {
    return [];
  }
}

export async function autosaveNow(): Promise<void> {
  const st = useStore.getState();
  const text = serializeProject(st.project);
  try {
    if (isTauri()) {
      const p = await autosavePath();
      if (p) await writeText(p, text);
    } else {
      localStorage.setItem(AUTOSAVE_KEY, text);
    }
  } catch (e) {
    console.warn("autosave failed", e);
  }
}

export function startAutosave(intervalMs = 30000) {
  if (autosaveTimer) window.clearInterval(autosaveTimer);
  autosaveTimer = window.setInterval(() => {
    if (useStore.getState().dirty) void autosaveNow();
  }, intervalMs);
  window.addEventListener("blur", () => {
    if (useStore.getState().dirty) void autosaveNow();
  });
}

/** The view stored with the autosave (tabs, zoom) for recovery. */
export async function loadAutosaveView(): Promise<ProjectView | null> {
  try {
    if (isTauri()) {
      const p = await autosavePath();
      if (!p) return null;
      const { exists } = await import("@tauri-apps/plugin-fs");
      if (!(await exists(p))) return null;
      return deserializeProjectFile(await readText(p)).view;
    }
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? deserializeProjectFile(text).view : null;
  } catch {
    return null;
  }
}

export async function loadAutosave(): Promise<Project | null> {
  try {
    if (isTauri()) {
      const p = await autosavePath();
      if (!p) return null;
      const { exists } = await import("@tauri-apps/plugin-fs");
      if (!(await exists(p))) return null;
      return deserializeProject(await readText(p));
    }
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? deserializeProject(text) : null;
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    if (isTauri()) {
      const p = await autosavePath();
      if (!p) return;
      const { exists, remove } = await import("@tauri-apps/plugin-fs");
      if (await exists(p)) await remove(p);
    } else {
      localStorage.removeItem(AUTOSAVE_KEY);
    }
  } catch {
    /* ignore */
  }
}
