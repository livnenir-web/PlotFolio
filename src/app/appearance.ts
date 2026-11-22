// How the app itself looks (not the figures): the accent color and light / dark. Kept on this computer
// (localStorage), not in the project; every window of the app follows it.

import { create } from "zustand";
import { isTauri } from "../io/platform";

export interface Accent {
  id: string;
  name: string;
  /** the accent on light and on dark surfaces */
  light: string;
  dark: string;
}

/** Restrained accents: the color only marks what is selected and the one main button of a view. */
export const ACCENTS: Accent[] = [
  { id: "blue", name: "Blue", light: "#2b6fd6", dark: "#5b9df5" },
  { id: "indigo", name: "Indigo", light: "#5754c9", dark: "#8e8cf2" },
  { id: "teal", name: "Teal", light: "#0e8577", dark: "#3fbfae" },
  { id: "green", name: "Green", light: "#2e8540", dark: "#5fc474" },
  { id: "orange", name: "Orange", light: "#c2590f", dark: "#f0914a" },
  { id: "rose", name: "Rose", light: "#c23a66", dark: "#f07a9d" },
  { id: "graphite", name: "Graphite", light: "#55575e", dark: "#a3a5ad" },
];

export type AppearanceMode = "auto" | "light" | "dark";

interface Stored {
  accent: string;
  mode: AppearanceMode;
}

const KEY = "plotfolio.appearance.v1";
const DEFAULT: Stored = { accent: "blue", mode: "auto" };

function load(): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Stored>;
    return {
      accent: ACCENTS.some((a) => a.id === v.accent) ? v.accent! : DEFAULT.accent,
      mode: v.mode === "light" || v.mode === "dark" ? v.mode : "auto",
    };
  } catch {
    return DEFAULT;
  }
}

const systemDark = (): boolean => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;

interface AppearanceState extends Stored {
  /** whether dark colors are in use now (the chosen mode, or the system's in "auto") */
  dark: boolean;
  setAccent: (id: string) => void;
  setMode: (mode: AppearanceMode) => void;
}

export const useAppearance = create<AppearanceState>((set, get) => {
  const commit = (patch: Partial<Stored>) => {
    const next = { accent: get().accent, mode: get().mode, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode etc. */
    }
    set({ ...next, dark: next.mode === "auto" ? systemDark() : next.mode === "dark" });
    apply();
  };
  const first = typeof localStorage === "undefined" ? DEFAULT : load();
  return {
    ...first,
    dark: first.mode === "auto" ? systemDark() : first.mode === "dark",
    setAccent: (accent) => commit({ accent }),
    setMode: (mode) => commit({ mode }),
  };
});

/** Write the choice onto the page: `data-theme` on the root (absent in "auto") and the two accent variables. */
function apply(): void {
  if (typeof document === "undefined") return;
  const { accent, mode } = useAppearance.getState();
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  const a = ACCENTS.find((x) => x.id === accent) ?? ACCENTS[0];
  root.style.setProperty("--accent-l", a.light);
  root.style.setProperty("--accent-d", a.dark);
  // the window frame (title bar, native menus and scroll bars) follows as well
  if (isTauri()) {
    void import("@tauri-apps/api/window")
      .then((m) => m.getCurrentWindow().setTheme(mode === "auto" ? null : mode))
      .catch(() => {});
  }
}

/** Call once at start-up, before the first render. Keeps the page in step with the system and with other windows. */
export function initAppearance(): void {
  if (typeof window === "undefined") return;
  apply();
  const refresh = () => {
    const s = load();
    useAppearance.setState({ ...s, dark: s.mode === "auto" ? systemDark() : s.mode === "dark" });
    apply();
  };
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", refresh);
  // another window of the app changed the setting
  window.addEventListener("storage", (e) => e.key === KEY && refresh());
}
