// Ask to save before the main window closes or the app quits with unsaved changes.
import { useStore } from "../model/store";
import { useDialogs } from "./dialogs";
import { isTauri } from "../io/platform";
import { saveProject } from "../io/project";
import { closeThisWindow, isProjectWindow, requestQuitAll } from "./windows";

let installed = false;

export async function installCloseGuard(): Promise<void> {
  if (installed || !isTauri()) return;
  installed = true;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  if (!isProjectWindow(win.label)) return;
  await win.onCloseRequested((event) => {
    event.preventDefault();
    if (!useStore.getState().dirty) {
      // clean close: drop the autosave so the next start does not offer a recovery
      void closeThisWindow();
      return;
    }
    useDialogs.getState().setClosePrompt({ mode: "close" });
  });
}

/** Quit the app: every project window closes itself, asking about its own unsaved changes. */
export async function requestQuit(): Promise<void> {
  await requestQuitAll();
}

/** The prompt's three outcomes. */
export async function resolveClosePrompt(action: "save" | "discard" | "cancel"): Promise<void> {
  const prompt = useDialogs.getState().closePrompt;
  useDialogs.getState().setClosePrompt(null);
  if (!prompt || action === "cancel") return;
  if (action === "save") {
    const ok = await saveProject(false);
    if (!ok) return; // the save dialog was cancelled: stay open
  }
  // saved or deliberately discarded: nothing to recover next time. Quitting closes window by window; the
  // app exits with the last one.
  await closeThisWindow();
}
