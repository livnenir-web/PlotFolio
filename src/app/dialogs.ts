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
  fitDialog: { graphId: string; layerId: string; plotId: string | null } | null;
  setFitDialog: (v: { graphId: string; layerId: string; plotId: string | null } | null) => void;
  rangePick: { graphId: string; layerId: string; onPick: (from: number, to: number) => void } | null;
  setRangePick: (v: DialogState["rangePick"]) => void;
  analysis: { op: import("../analysis/AnalysisDialog").AnalysisOp; sheetId: string } | null;
  setAnalysis: (v: DialogState["analysis"]) => void;
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
  fitDialog: null,
  setFitDialog: (fitDialog) => set({ fitDialog }),
  rangePick: null,
  setRangePick: (rangePick) => set({ rangePick }),
  analysis: null,
  setAnalysis: (analysis) => set({ analysis }),
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
  toast: null,
  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => set((s) => (s.toast === msg ? { toast: null } : {})), 3000);
  },
}));
