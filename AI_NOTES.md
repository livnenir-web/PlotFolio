# PlotFolio — notes for AI assistants

Read this before changing PlotFolio. It says what the app is, how the code is organised, the rules that keep it
fast and its exports stable, and how to verify a change. It is shown inside the app (About ▸ Notes for AI
Assistants) and lives at the repository root as `AI_NOTES.md`.

## What PlotFolio is

A native macOS plotting app for a researcher who used OriginLab's Origin: data sheets → graphs with any number of
layers (sets of axes) on a canvas measured in millimetres → curve fitting and analysis → publication-quality SVG/PNG
export at the physical size. One native window per project, pop-out windows for single sheets or graphs, `.plotproj`
JSON project files.

Stack: Tauri 2 (Rust shell, `src-tauri/`), React 18 + TypeScript (Vite), zustand 5 + immer + zundo (undo), an own SVG
renderer (no charting library), Glide Data Grid for the sheet, mathjs for formulas, Levenberg–Marquardt for fits.

## Layout of the code

| Area | Files | Notes |
|---|---|---|
| Data model | `src/model/types.ts`, `defaults.ts`, `palettes.ts`, `figure.ts` | `Project { sheets, graphs, folders, defaults }`. `Graph { canvas, layers, texts, shapes, groups }`. `Layer { frame (mm), axes {x,y,y2,z}, plots, legend, colorScale, fits }`. Units: mm for sizes/positions, pt for fonts and line widths. |
| Store | `src/model/store.ts` | One zustand store per window. `mutate(fn)` edits the project with immer and marks it dirty; `ui` holds selection, `multi` (extra selected objects), tabs, zoom. zundo `temporal` gives undo; `pauseHistory/resumeHistory` wrap multi-step edits. `useStoreEq(selector, eq)` is the custom-equality hook. |
| Layout engine | `src/graph/layout.ts`, `scales.ts`, `ticks.ts`, `customTicks.ts`, `units.ts`, `data.ts`, `matrix.ts` | Pure functions: `layoutGraph(project, graph)` → per-layer `layoutLayer` → scales (`buildScale`, piecewise with axis breaks), tick labels, axis geometry (`axisGeom`), legend geometry, shape/text positions in canvas mm. Everything is cached on object identity (WeakMaps) — see Performance. |
| Rendering | `src/graph/render/GraphSvg.tsx`, `plots2d.tsx`, `Layer3D.tsx`, `heatmapRaster.ts`, `paths.ts`, `colormaps.ts`, `contour.ts` | `GraphSvg` renders a graph from its layout; the same component produces the on-screen SVG (`interactive`) and the exported SVG (not interactive: no hit areas, no `data-drag` wrappers). Exports must stay byte-identical when you touch rendering. |
| Interaction | `src/graph/GraphView.tsx` (large) | Canvas view: selection, lasso, drags (move/resize/rotate/handles), drawing tools, groups, smart alignment guides, grid arrangement, keyboard shortcuts, context menus, toolbar. Move drags set `transform` on `data-drag` groups and commit one store write at pointer-up. |
| Inspector | `src/graph/inspector/*.tsx`, `src/app/Inspector.tsx` | Right-hand panel editing the selected canvas/layer/axis/plot/legend/text/shape. `upd()` helpers apply an edit to every co-selected object of the same kind (`useCoSelected`). |
| Sheet | `src/sheet/SheetView.tsx`, `ImportDialog.tsx`, `PlotDialog.tsx`, `stats.ts` | Glide grid with header rows Name / Units / Comments / F(x) / sparkline. Column header drag → drop on a graph adds plots (`src/io/columnDrag.ts`, `columnDrop.ts`). |
| Formulas | `src/formula/engine.ts` | Column formulas in mathjs (`A*2`, `log10(B)`, `i` = row index). Parsed/compiled expression caches, partial recalculation of dependent columns. |
| Fitting / analysis | `src/fit/engine.ts`, `functions.ts`, `runFit.ts`, `FitDialog.tsx`; `src/analysis/signal.ts` | LM fits with standard errors, R², χ², confidence and prediction bands (`predictWithBand`); fits re-run when their source sheet changes. Smoothing, derivative, integral, FFT, normalise, average, interpolate. |
| I/O | `src/io/project.ts`, `importFiles.ts`, `importText.ts`, `importXlsx.ts`, `images.ts`, `platform.ts`, `recent.ts` | `.plotproj` (JSON, `PROJECT_VERSION`, optional `view` for restoring tabs/zoom), per-window autosave + recovery, CSV/TSV/Excel import, pictures as `image` shapes (data URLs), platform wrappers around Tauri fs/dialog with browser fallbacks. |
| Export | `src/export/exportGraph.ts`, `csv.ts`, `ExportDialog.tsx` | SVG at physical size, PNG/JPEG at any DPI, clipboard. |
| App shell | `src/app/App.tsx`, `PopoutApp.tsx`, `Toolbar.tsx`, `Sidebar.tsx`, `TabBar.tsx`, `menu.ts`, `windows.ts`, `popout.ts`, `closeGuard.ts`, `dialogs.ts`, `AboutDialog.tsx`, `styles.css` | Native menu commands arrive as a `menu` event with an id (ids defined in `src-tauri/src/menu.rs`, handled in `src/app/menu.ts`; only the focused window acts). Dialog visibility lives in the `useDialogs` store. |
| Rust | `src-tauri/src/lib.rs`, `menu.rs`, `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json` | Menu bar, Open Recent, file associations (`.plotproj` double-click → `RunEvent::Opened` routed to the focused project window), `OpenFiles` registry (one window per file), NSDocumentController recent documents for the Dock menu, `force_quit`. |

## Conventions and rules

- **Units**: positions and sizes in mm (`fmtMm` formats them for SVG), fonts and strokes in pt (`ptToMm`). Canvas
  origin is top-left. Objects with `coord: "data"` are stored in axis values and converted through the layer layout.
- **Performance** (keep it): derived data is cached on identity — `getPlotData` per plot, `layoutLayer` per
  `(layer, project.sheets)`, `layoutGraph` per `(graph, sheets)`, text measurement per string, isolines per matrix,
  heatmap rasters by a translation-invariant key. `LayerG`, `PlotG`, `AxisG`, `LegendG`, `ShapeG`, `TextG`,
  `CellsG` are `React.memo`. Never write the store per pointer move for a pure move; preview with transforms and
  commit once. Dev globals `window.__layoutStats` / `window.__renderStats` count cache hits and renders.
- **Undo**: one user action = one undo step. Wrap multi-write actions in `pauseHistory()` … `resumeHistory()` or
  batch them into a single `mutate`.
- **Multi-selection**: `ui.selection` is the primary object, `ui.multi` the others. Inspector edits go to all
  co-selected objects of the same kind through the `upd` helpers; group membership lives in `graph.groups`.
- **Multi-window**: labels are `main`, `project-<id>`, and pop-outs `<parent>--graph-<id>` / `--sheet-<id>`. Anything
  emitted to a window must use the parent/current label. Menu listeners act only when the window is focused.
- **Exports**: `GraphSvg` without `interactive` must produce the same markup as before your change unless the
  change is intentional. Compare the SHA-256 of `__svg(project, graph)` before and after.
- **Project files**: add new optional fields to the types; never rename or remove fields without a migration in
  `deserializeProjectFile`. Old files must open.
- **UI text**: plain sentences, no jargon in tooltips; hints explain what a control does to the figure.
- **Dev helpers** (browser preview only): `window.__store`, `__importFile`, `__svg`, `__raster`, `__layoutStats`,
  `__renderStats`.

## How to work on it

```bash
npm install
npm run dev                # Vite preview in the browser (file dialogs fall back to downloads)
npm run tauri dev          # native app with hot reload (needs Rust: ~/.cargo/bin on PATH)
npm run typecheck          # tsc --noEmit
npx vitest run             # unit tests (scales/breaks, layout cache, formulas, fitting, signal, export)
npm run tauri build        # → src-tauri/target/release/bundle/macos/PlotFolio.app
```

Checklist for a change: typecheck, tests, exercise the feature in the preview (synthetic pointer events are fine;
the hidden browser pane throttles `requestAnimationFrame`, so do not await frames in scripts), compare export hashes
if rendering changed, rebuild the app. The owner tests the Mac app by hand; say what you could not verify.

## Where to add things

- A new plot style: `types.ts` (plot options) → `layout.ts` (geometry) → `plots2d.tsx`/`GraphSvg.tsx` (drawing) →
  `inspector/PlotTypeFields.tsx` (controls) → defaults in `defaults.ts`.
- A new axis option: `Axis` in `types.ts` → `scales.ts`/`axisGeom` in `layout.ts` → `AxisG` → axis rows in
  `GraphInspector.tsx`. Custom ticks (`customTicks`, `customTicksMode`) are merged into `scale.major` in
  `buildScale`; their labels travel as `scale.customLabels`.
- A whole-figure edit (every text style, every plot colour): helpers in `src/model/figure.ts`, UI in the
  `FigureGroup` of the canvas inspector. Palettes are listed in `src/model/palettes.ts` (also used by Settings).
  Plot styles (`plotStyleOf` / `applyPlotStyle` / `applyStyleToPlots` and the style clipboard) live there too.
- Inspector sections are an accordion: `InspectorPanel kind=…` wraps each panel and every titled `Group` inside it
  collapses; the open section per panel kind is kept in `useInspectorSections` (localStorage). Give a Group an `id`
  when its title changes with the selection. Plot and Axis panels apply edits to every co-selected object.
- Bars: width, stacking and direction are read from the first bar plot of the layer (`BarFields` writes them to
  all bar plots); per-plot colour mode (plot / per category from `ll.palette` / colour-by column), hatch patterns
  (`<pattern>` defs inside the plot group, ids from `barPatternId`) and value labels reuse `plot.labels`.
- A new drawn object: `ShapeKind` → `shapeGeometry`/`shapePointsMm` in `layout.ts` → `ShapeG` → `ShapeInspector`
  → drawing tool in `GraphView.tsx` (`drag.kind === "draw"`, `finishPoly`).
- A new menu command: id in `menu.rs` → `handleMenu` in `menu.ts` (and the browser keyboard fallback in `App.tsx`
  if it needs a shortcut without the native menu).
- A new analysis: `signal.ts` + `AnalysisDialog.tsx`, menu id `an:<op>`.
