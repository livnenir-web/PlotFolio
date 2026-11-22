import { create } from "zustand";
import type { XlsxWorkbook } from "../io/importXlsx";

export interface ImportSource {
  name: string;
  text?: string;
  workbook?: XlsxWorkbook;
}

interface DialogState {
  importSource: ImportSource | null;
  setImportSource: (s: ImportSource | null) => void;
  plotDialog: { sheetId: string } | null;
  setPlotDialog: (v: { sheetId: string } | null) => void;
  exportDialog: { graphId: string } | null;
  setExportDialog: (v: { graphId: string } | null) => void;
  /** export of a figure's animation (video, GIF, frames) */
  animationExport: { graphId: string } | null;
  setAnimationExport: (v: { graphId: string } | null) => void;
  fitDialog: { graphId: string; layerId: string; plotId: string | null } | null;
  setFitDialog: (v: { graphId: string; layerId: string; plotId: string | null } | null) => void;
  /** `what` names the range in the banner (default "fit range") */
  rangePick: { graphId: string; layerId: string; onPick: (from: number, to: number) => void; what?: string } | null;
  setRangePick: (v: DialogState["rangePick"]) => void;
  /** an Analysis command on the columns of a sheet */
  analysis: { op: Exclude<import("../analysis/ops").AnalysisOp, "math">; sheetId: string } | null;
  setAnalysis: (v: DialogState["analysis"]) => void;
  /** an Analysis command on the curves of a graph, with the selected ones checked */
  curveAnalysis: import("../analysis/CurveAnalysisDialog").CurveAnalysisInit | null;
  setCurveAnalysis: (v: DialogState["curveAnalysis"]) => void;
  /** Statistics of the plots of a graph, shown over the figure */
  stats: import("../analysis/StatsDialog").StatsInit | null;
  setStats: (v: DialogState["stats"]) => void;
  /** Compare Groups: statistical tests between the columns of a sheet, or between the plots of a graph */
  compare: import("../analysis/CompareDialog").CompareInit | null;
  setCompare: (v: DialogState["compare"]) => void;
  functionDialog: { graphId: string; layerId: string | "new" } | null;
  setFunctionDialog: (v: { graphId: string; layerId: string | "new" } | null) => void;
  /** columns being dragged from a sheet (pointer-based), and the graph currently under the pointer */
  columnDrag: { sheetId: string; cols: number[]; x: number; y: number; overGraphId: string | null } | null;
  /** id of the image shape whose edges currently crop instead of resize */
  cropShapeId: string | null;
  setCropShapeId: (id: string | null) => void;
  setColumnDrag: (v: DialogState["columnDrag"]) => void;
  closePrompt: { mode: "close" | "quit" } | null;
  setClosePrompt: (v: { mode: "close" | "quit" } | null) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  /** About dialog: "about" shows the version page, "notes" the notes for AI assistants */
  aboutOpen: "about" | "notes" | null;
  setAboutOpen: (v: "about" | "notes" | null) => void;
  /** the Shortcuts and gestures sheet */
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean) => void;
  toast: string | null;
  showToast: (msg: string) => void;
}

export const useDialogs = create<DialogState>((set) => ({
  importSource: null,
  setImportSource: (importSource) => set({ importSource }),
  plotDialog: null,
  setPlotDialog: (plotDialog) => set({ plotDialog }),
  exportDialog: null,
  setExportDialog: (exportDialog) => set({ exportDialog }),
  animationExport: null,
  setAnimationExport: (animationExport) => set({ animationExport }),
  fitDialog: null,
  setFitDialog: (fitDialog) => set({ fitDialog }),
  rangePick: null,
  setRangePick: (rangePick) => set({ rangePick }),
  analysis: null,
  setAnalysis: (analysis) => set({ analysis }),
  curveAnalysis: null,
  setCurveAnalysis: (curveAnalysis) => set({ curveAnalysis }),
  stats: null,
  setStats: (stats) => set({ stats }),
  compare: null,
  setCompare: (compare) => set({ compare }),
  functionDialog: null,
  setFunctionDialog: (functionDialog) => set({ functionDialog }),
  columnDrag: null,
  cropShapeId: null,
  setCropShapeId: (cropShapeId) => set({ cropShapeId }),
  setColumnDrag: (columnDrag) => set({ columnDrag }),
  closePrompt: null,
  setClosePrompt: (closePrompt) => set({ closePrompt }),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  aboutOpen: null,
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  toast: null,
  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => set((s) => (s.toast === msg ? { toast: null } : {})), 3000);
  },
}));
