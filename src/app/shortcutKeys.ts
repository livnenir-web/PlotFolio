// The key handler of a window: looks a key press up in the shortcut registry (defaults plus the user's own, see
// shortcuts.ts) and runs the command. Installed by the main window (every command) and by pop-out windows (the
// commands that make sense there).
import { useStore, undo, redo } from "../model/store";
import { handleMenu } from "./menu";
import { shell } from "../io/platform";
import { IS_MAC } from "./menuModel";
import { bindingOf, commandForCombo, comboOf, installShortcutSync, nativeHandles, REDO_COMBOS } from "./shortcuts";

/** playback keys: they act only on an animated figure, so that Space and the like stay free elsewhere */
const ANIMATION_KEYS = new Set(["playAnimation", "animStepBack", "animStepForward", "animFirst", "animLast"]);

/**
 * Listen for shortcuts in this window. `only` limits the commands (pop-out windows); the main window also closes
 * the current tab with ⌘W. Returns the function that removes the listeners.
 */
export function installShortcutKeys(only?: Set<string>): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    const combo = comboOf(e);
    if (!combo) return;
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
    // AltGr (Ctrl+Alt on Windows keyboards) types letters such as ś or @: in a text field it is never a shortcut
    if (typing && !IS_MAC && e.getModifierState?.("AltGraph")) return;
    const st = useStore.getState();
    // fixed keys that are not looked up
    if (combo === "Mod+Z" || REDO_COMBOS.includes(combo)) {
      if (typing) return;
      e.preventDefault();
      combo === "Mod+Z" ? undo() : redo();
      return;
    }
    if (combo === "Mod+W" && !typing && !only) {
      e.preventDefault();
      if (st.ui.activeTab) st.closeTab(st.ui.activeTab);
      return;
    }
    if (document.querySelector(".modal-backdrop")) return; // a dialog is open: keys belong to it
    const cmd = commandForCombo(combo, st.ui.activeTab?.kind ?? null);
    if (!cmd || (only && !only.has(cmd.id))) return;
    if (typing && !(cmd.whileTyping && combo.includes("Mod+"))) return;
    // in the Mac app the menu bar acts on its own shortcuts
    if (nativeHandles(cmd.id) && bindingOf(cmd.id) === combo) return;
    // animation keys do nothing (and stay free for the page) on a figure that is not animated
    if (ANIMATION_KEYS.has(cmd.id)) {
      const g = st.ui.activeTab?.kind === "graph" ? st.project.graphs.find((x) => x.id === st.ui.activeTab!.id) : undefined;
      if (!g?.animation?.enabled) return;
    }
    e.preventDefault();
    handleMenu(cmd.id);
  };
  window.addEventListener("keydown", onKey);
  // after onKey, so that a shortcut of PlotFolio on one of these keys has already run
  const unGuard = shell() === "windows" ? installWebviewKeyGuard() : () => {};
  const unSync = installShortcutSync();
  return () => {
    window.removeEventListener("keydown", onKey);
    unGuard();
    unSync();
  };
}

/** Ctrl with these keys edits text: the web view must keep handling them. */
const TEXT_KEYS = new Set(["KeyA", "KeyC", "KeyV", "KeyX", "KeyZ", "KeyY", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Backspace", "Delete", "Home", "End", "Insert"]);

/**
 * The Windows app only. Its web view (WebView2) is a browser engine with a browser's own keys: F5 and Ctrl+R reload
 * the page (and lose the unsaved state), Ctrl+P prints, Ctrl+F opens a find bar, F7 turns on caret browsing,
 * Alt+← goes back, Ctrl with + and − zooms the whole page. None of that belongs in an app, so those keys are
 * stopped here unless PlotFolio uses them itself. A press of Alt alone would move the keyboard to the window's
 * system menu and swallow the next key; Alt is held for gestures on a graph, so that is stopped too.
 * The same goes for the web view's own right-click menu (Back, Refresh, Print…) where PlotFolio shows none of its
 * own; text fields keep theirs, for cut, copy and paste.
 */
function installWebviewKeyGuard(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const lone = e.key === "Alt" || e.key === "F10";
    const browserKey =
      (e.ctrlKey && !e.altKey && !TEXT_KEYS.has(e.code) && !["Control", "Shift"].includes(e.key) && !(import.meta.env.DEV && e.shiftKey && e.code === "KeyI")) ||
      (!e.ctrlKey && !e.altKey && ["F3", "F5", "F7"].includes(e.key)) ||
      (e.altKey && !e.ctrlKey && ["ArrowLeft", "ArrowRight", "Home"].includes(e.key));
    if (lone || browserKey) e.preventDefault();
  };
  const onContextMenu = (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t || !(t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) e.preventDefault();
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  window.addEventListener("contextmenu", onContextMenu);
  return () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKey);
    window.removeEventListener("contextmenu", onContextMenu);
  };
}
