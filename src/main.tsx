import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { PopoutApp } from "./app/PopoutApp";
import { popoutTarget } from "./app/popout";
import { layoutStats } from "./graph/layout";
import { renderStats } from "./graph/render/GraphSvg";
import "./app/styles.css";
import { useDialogs } from "./app/dialogs";
import { sheetPasteRef, sheetSelectionRef } from "./sheet/SheetView";
import { useStore } from "./model/store";
import { importFileObject } from "./io/importFiles";
import { graphToSvg, graphToRaster } from "./export/exportGraph";

if (import.meta.env.DEV) Object.assign(window, { __store: useStore, __dialogs: useDialogs, __sheetPaste: sheetPasteRef, __sheetSel: sheetSelectionRef, __importFile: importFileObject, __svg: graphToSvg, __raster: graphToRaster, __layoutStats: layoutStats, __renderStats: renderStats });

const popout = popoutTarget();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{popout ? <PopoutApp tab={popout} /> : <App />}</React.StrictMode>,
);
