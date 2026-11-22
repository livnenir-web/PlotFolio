# PlotFolio — notes for AI assistants

Read this before changing PlotFolio. It says what the app is, how the code is organized, the rules that keep it
fast and its exports stable, and how to verify a change. It is shown inside the app (About ▸ Notes for AI
Assistants) and lives at the repository root as `AI_NOTES.md`.

## What PlotFolio is

A desktop plotting app (Mac and Windows, plus a browser build) for a researcher who used OriginLab's Origin: data sheets → graphs with any number of
layers (sets of axes) on a canvas measured in millimeters → curve fitting and analysis → publication-quality SVG/PNG
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
| Interaction | `src/graph/GraphView.tsx` (large) | Canvas view: selection, lasso, drags (move/resize/rotate/handles), drawing tools, groups, smart alignment guides, grid arrangement, keyboard shortcuts, context menus, toolbar. Move drags set `transform` on `data-drag` groups and commit one store write at pointer-up. Shift during a drag keeps it on a line (`src/graph/constrain.ts`): moves go level or upright (and do not snap), a line end or the end vertex of a polyline turns in 45° steps or slides along its own direction, a rect / ellipse keeps its proportions, a polyline segment being placed keeps to 45° steps. Lines, arrows, polylines and pen strokes carry a shape at each end (`headStart` / `headEnd` with `headStartShape` / `headEndShape`: arrow, circle, square, diamond, bar; `lineEndOf` and `cutPolylineEnd` in `paths.ts`, drawn by `LineEndMark` in `GraphSvg.tsx`). |
| Inspector | `src/graph/inspector/*.tsx`, `src/app/Inspector.tsx` | Right-hand panel editing the selected canvas/layer/axis/plot/legend/text/shape. `upd()` helpers apply an edit to every co-selected object of the same kind (`useCoSelected`). |
| Sheet | `src/sheet/SheetView.tsx`, `ImportDialog.tsx`, `PlotDialog.tsx`, `stats.ts` | Glide grid with header rows Name / Units / Comments / F(x) / sparkline. Column header drag → drop on a graph adds plots (`src/io/columnDrag.ts`, `columnDrop.ts`). |
| Formulas | `src/formula/engine.ts` | Column formulas in mathjs (`A*2`, `log10(B)`, `i` = row index). Parsed/compiled expression caches, partial recalculation of dependent columns. |
| Fitting / analysis | `src/fit/engine.ts`, `functions.ts`, `runFit.ts`, `FitDialog.tsx`; `src/analysis/signal.ts` | LM fits with standard errors, R², χ², confidence and prediction bands (`predictWithBand`); fits re-run when their source sheet changes. Smoothing, derivative, integral, FFT, normalize, average, interpolate. The Analysis commands run from a sheet (`AnalysisDialog`, on its selected columns) or from a graph (`CurveAnalysisDialog`, on its curves with the selected ones checked; they may read several sheets and sit in several panels; results become new columns in the sheet the data came from, named after the curve, or a new sheet on request, and are drawn on the figure, which stays in front: a spectrum or a CDF in a new panel). Both share the command settings and math in `src/analysis/ops.tsx`; `graphCurves.ts` picks the plots and says which kinds a command reads (`CurveUse`: curve commands take symbol and line plots, CDF and Statistics also histograms, boxes and bars; a command never falls back from a selected plot it cannot read to other plots). `start.ts` starts every graph-side command (menu bar and right-click menus). Curve math (`an:math`, graph only): each curve + − × ÷ a number or another curve read at the same x. Right-click a plot ▸ Analyze offers the commands that fit it. A command made of several store calls is one undo step through `oneUndoStep` (`store.ts`). Rule from Nir (2026-11-22): the app is plot-centered — operations start from the figure, and every new data set becomes new columns in the same sheet with a telling title. The Mac menu bar cannot dim items, so a sheet-only command chosen on a graph shows a toast (`needsSheet` in `src/app/menu.ts`) instead of doing nothing. |
| Statistics | `src/analysis/compare.ts`, `distributions.ts`, `compareGraph.ts`, `CompareDialog.tsx` | Compare Groups (Analysis menu): t-test (Welch, equal variances, paired), one-way ANOVA with Tukey or Holm-corrected pairs, two-sample Kolmogorov–Smirnov (exact p), empirical CDF (`ecdf`). Pure functions, checked against SciPy values in `compare.reference.json`. `compareGraph.ts` puts the result on a graph: brackets over box-type plots (`withBrackets`) or a line of text above a CDF layer. Opened from a sheet the groups are its columns; opened from a graph (`CompareInit` without `sheetId`) they are the plots of the figure, each with the numbers of its data column, whichever sheets they read. Statistics from a graph is a table over the figure (`StatsDialog.tsx`), from a sheet a report sheet (`sheet/stats.ts`). |
| Excluded points | `src/model/exclude.ts`, `store.excludePoints` / `includePoints` | Right-click a point ▸ Exclude point (or a plot ▸ Exclude points in an x range…). No mask: the value moves from its column to a column "… (excluded)" of the same sheet, on the same row (`column.excludedFrom` = the id of the source column), drawn as a gray hollow plot that is left out of the legend and can be hidden. Fits and analysis read the data column and so skip the point. Include again moves the value back; the column and its plot go with the last point. Formula columns are refused. `pointNear` (GraphView) finds the point, `plotRowIndices` (`graph/data.ts`) its sheet row. |
| I/O | `src/io/project.ts`, `importFiles.ts`, `importText.ts`, `importXlsx.ts`, `images.ts`, `platform.ts`, `recent.ts` | `.plotproj` (JSON, `PROJECT_VERSION`, optional `view` for restoring tabs/zoom), per-window autosave + recovery, CSV/TSV/Excel import, pictures as `image` shapes (data URLs), platform wrappers around Tauri fs/dialog with browser fallbacks. |
| Animation | `src/graph/animation.ts`, `animationPlayback.ts`, `AnimationBar.tsx`, `inspector/AnimationFields.tsx`; `src/export/exportAnimation.ts`, `AnimationExportDialog.tsx` | `graph.animation` (optional): one timeline with three effects that combine — reveal the data over time with the current point marked, turn a 3D view, build the figure up plot by plot, group by group or layer by layer (`buildUp.unit`, steps from `buildUpUnits`). `animationFrame(layout, anim, t)` derives a frame from the cached layout; see Animation below. |
| Export | `src/export/exportGraph.ts`, `csv.ts`, `ExportDialog.tsx` | SVG at physical size, PNG/JPEG at any DPI, clipboard. |
| App shell | `src/app/App.tsx`, `PopoutApp.tsx`, `Toolbar.tsx`, `Sidebar.tsx`, `TabBar.tsx`, `menu.ts`, `windows.ts`, `popout.ts`, `closeGuard.ts`, `dialogs.ts`, `AboutDialog.tsx`, `styles.css` | Menu commands are ids handled by `handleMenu` in `src/app/menu.ts`. The Mac app sends them from the native menu bar (`src-tauri/src/menu.rs`) as a `menu` event, and only the focused window acts; the Windows app and the browser build draw their own menus (`menuModel.ts`, `MenuBar.tsx`). See "Three builds" below. Dialog visibility lives in the `useDialogs` store. |
| Curve groups | `src/model/plotGroups.ts`, `src/graph/inspector/PlotGroups.tsx` | `graph.plotGroups` plus `plot.groupId`: curves that belong together, in one layer or across the layers of a figure. A group folds in the layer's Plots list, is hidden and shown as one (`setGroupShown` remembers which curves were shown), is selected as one for editing (`store.selectMany`: the plot inspector already edits every selected plot) and can color its curves (`group.colors`: a palette, shades of one color or a colormap, applied per layer in drawing order). `tidyGroups` runs at the end of every graph update in the store and keeps membership, order and colors consistent. |
| Start screen and gallery | `src/app/StartScreen.tsx`; `src/sheet/PlotDialog.tsx`, `PlotKindIcon.tsx`, `plotPreview.ts`, `src/graph/plotKinds.ts` | An untouched project shows the start screen in place of the empty sheet (`useShowStart`: no file, no graph, no data, not put away for this `loadSeq`). Plot Columns is a gallery of plot kinds (`PLOT_KINDS`: a plot type plus an optional `apply` variant) with a preview drawn by `GraphSvg` from a throw-away graph (`previewGraph`). |
| Rust | `src-tauri/src/lib.rs`, `menu.rs`, `Cargo.toml`, `tauri.conf.json`, `tauri.windows.conf.json`, `capabilities/default.json` | Mac menu bar and its Open Recent; opening a `.plotproj` from outside (Mac: `RunEvent::Opened`; Windows: the command line, and `tauri-plugin-single-instance` for a second double-click), routed by `deliver_open` to the focused project window; `OpenFiles` registry (one window per file), NSDocumentController recent documents for the Dock menu, `force_quit`. |

## Conventions and rules

- **Look ("Instrument")**: neutral surfaces, hairlines, corners of 3–4 px, numbers in tabular figures. The accent
  color only marks what is selected (a thin line on the sidebar item, the tab, the chosen segment) and the one main
  button of a view; nothing else is colored. All colors are the CSS variables at the top of `src/app/styles.css`
  (light, plus one dark block written twice: for `data-theme="dark"` and for the system setting). The accent and
  Light / Dark / Auto are chosen in Settings ▸ Appearance (`src/app/appearance.ts`, kept in localStorage, not in the
  project; `initAppearance` runs before the first render and sets `data-theme`, `--accent-l` and `--accent-d`).
  In the dark mode the tools are graphite and the figure's page keeps its own color, so it is the only bright thing
  on screen. Floating surfaces (menus, dialogs, previews) use `--pop-bg`, color swatches `--swatch-border`; never
  hard-code a light or dark color for the app's own surfaces.
- **Explanations live on hover**, not on the page. How-to text goes into the `title` of the control or `Row` it
  explains, or — for a whole section — into the `info` of its `Group` (a small "i" in the section title), or — for a
  whole dialog — into the `info` of its `Dialog` (an "i" next to the title).
  `TooltipLayer` (`src/ui/Tooltip.tsx`, mounted once per window) shows every `title` / `data-tip` in the app's own
  tooltip. Only text that reports a state stays visible, with class `note` ("No plots yet", "Editing 4 plots
  together"); class `hint` is for units and short labels next to a field.
- **Hidden layers** (`layer.hidden`, set with `setLayerShown` / `soloLayer` in `src/model/figure.ts`): a hidden
  layer stays in `graph.layers` (the Figure inspector's Layers list, with a tick like the plots of a layer) but
  `layoutGraph` leaves it out, so drawing, clicking, snapping, export, thumbnails and animation never meet it. Code
  that walks `graph.layers` to decide what is *on the figure* (analysis defaults, animation lists, where a new plot,
  text or shape goes) uses `shownLayers(graph)` / `defaultLayer(graph)` instead; code that edits the figure's
  content (palettes, fonts, groups, tidy) keeps walking all layers. Inspectors of a hidden layer, or of anything in
  it, show `HiddenLayerNote` with a Show button. A plot's own `visible` and its layer's `hidden` are independent.
- **What goes with a hidden plot**: tick a plot off through `setPlotShown(layer, plot, shown)` (`src/model/figure.ts`),
  never by writing `plot.visible`: it takes the fit curves made from the plot along (`fit.sourcePlotId`), which keep
  their own tick and can be shown alone afterwards. Significance brackets know their two box-type plots
  (`shape.between`, `src/model/brackets.ts`): `placeBrackets` runs at the start of the layer layout and puts each
  bracket over where its plots stand now, or leaves it out while one is hidden, so the stored shape is never
  rewritten (`ll.layer` is then a copy of the stored layer). Brackets of older files are linked when the project is
  opened (`linkBrackets`); `tidy` in the store drops the brackets of deleted plots. Code that copies a layer gives
  its plots new ids with `renewPlotIds`, which carries these two references along.
- **Lists select, double-click opens**: in the layer inspector's Plots list a click selects plots (⌘ / Shift for
  several) for Group and "Edit together"; a double-click opens the plot's (or the group's) details. Toolbars use
  frameless buttons; a toggle that is on looks like a pressed key (`.on`), and only the main action is filled.
- **Project manager** (`Sidebar.tsx`): one "+" menu for new items, a name filter behind the search button, and a
  small live picture of a figure (`GraphPeek`) while the pointer rests on its name.
- **Inspector structure** (one rule): objects with many settings have tabs, objects with few show everything.
  Figure (Figure / Style / Animation), layer (Plots / Axes / Layout), axis (Scale / Labels / Style) and plot
  (Style / Data / Labels) pass `tabs` to `InspectorPanel`; a `Group` shows under its `tab` (the first tab when it
  names none, `"*"` under all), and `InTab` sets the tab for sections rendered by other components. Under a tab
  the titled Groups fold, one open at a time; a tab's only section is always open. Text, legend, shape, color scale
  and column have no tabs and never fold. A one-line setting goes in an untitled `Group` (always visible) instead
  of a section of its own. `showInspectorTab(kind, tab)` brings a tab forward from elsewhere.
- **Field edits** (`TextField`, `NumberField`): a field applies every keystroke with history paused, and the whole
  edit is one undo step. The edit is registered with `beginEdit(end)` in the store and keeps the `onCommit` it
  started with. Whatever moves on ends it first through `endEdit()`: `setSelection`, `selectMany`, the tab
  actions, `pauseHistory()` (drags), `undo` / `redo`, and the field's own blur, Enter, Escape or unmount. So a value
  always lands on the object it was typed for and history is never left paused. `endEdit` records the step itself
  (project before the edit, then after), so a field needs no "put the start value back" logic. Never call
  `temporal.pause()` directly.
- **Every inspector is keyed by its object** (`key={layer.id}` and so on in `GraphInspector` and `Inspector`), so
  no field text or local state carries over when another object of the same kind is selected.
- **"Same style as X axis"** (`axis.sameAsX`) shares the look only: the keys in `AXIS_STYLE_KEYS` (`layout.ts`:
  fonts, tick direction and length, line width and color, title gap). Range, tick counts, labels, mirror and grid
  are always the axis's own, and the inspector shows them so. Unticking copies the look of X into the axis
  (`axisLookOf`), so nothing changes on the figure.
- **Quitting**: ⌘Q is our own menu item and sends "plotkit:quit"; every project window then closes itself or asks
  about its unsaved changes, and the app exits with the last window. A quit that does not come from the menu (Dock ▸
  Quit, logging out, `quit` from a script) goes to AppKit, and the window library's app delegate has no
  `applicationShouldTerminate:`. `quit_guard` in `lib.rs` adds one: while a project window is open it declines and
  sends the same event. To test without touching the real autosave, start the binary with `HOME` set to a
  scratch folder and send `osascript -e 'tell application id "com.nirlivne.plotfolio" to quit'`.
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
  `deserializeProjectFile`. Old files must open. When an existing field starts to mean something different, bump
  `PROJECT_VERSION` (`defaults.ts`) and migrate older versions in `parseProject` (`io/project.ts`), so old figures
  draw as before — e.g. version 2 turns `showMarkers` on for 3D scatters, which always drew their symbols before.
- **Animation**: a frame is never laid out again and never written to the document. `animationFrame` returns the
  layout itself when nothing is animated, otherwise a copy in which only the touched layers are new objects, with
  `ll.anim` (`LayerAnim` in `layout.ts`: interpolated end points, fades, current-point symbols, cursor, values).
  The renderer reads `ll.anim` only where it is set, so a figure without animation exports byte-identical markup,
  and picture exports of an animated figure show it complete. The playback position (`usePlayback`) is per window
  and transient: playing or scrubbing must not dirty the project or add undo steps. The preview and the export use
  the same `frameSchedule`, so they show the same frames. Video is H.264 through WebCodecs (`mediabunny`), GIF
  through `gifenc`; both are imported only when an export starts, and MP4 is offered only if `canExportMp4` says
  the system can encode it.
- **Shortcuts** (`src/app/shortcuts.ts`, `shortcutKeys.ts`, `ShortcutsDialog.tsx`): every command with a possible
  shortcut is in one registry, built from `WEB_MENUS` plus `EXTRA` (graph-view commands without a menu item). The
  user can change any that is not `fixed` (copy, paste, undo …) in Shortcuts and Gestures (About menu, or `?`);
  the choices live in localStorage on this computer (`plotfolio.shortcuts.v1`), never in the project, and "Restore
  default settings" clears them. Never compare `e.key` for a command key: `installShortcutKeys` (main window and
  pop-outs) turns a key press into a combo by key position (`comboOf`), finds the command (`commandForCombo`) and
  calls `handleMenu(id)`; commands that need the graph view's selection are forwarded as a `plotkit:graph` event.
  Show a shortcut with `keyHint(id)` / `keyHintSuffix(id)` so labels follow the user's choice, and other keys with
  `formatKeys("Mod+V")`, `MOD_KEY`, `ALT_KEY` (`menuModel.ts`): never write ⌘ or ⌥ in a string, the Windows app
  shows Ctrl and Alt. In the Mac app the menu bar owns shortcuts that include ⌘ (`syncNativeMenu` → Rust
  `set_menu_accelerators`) and the page skips those; in the Windows app and the browser the page handles all of
  them. Keys without ⌘ (Space, `?`, `,`) are always handled by the page so they never swallow typing. Only
  editing keys stay hard-coded in `GraphView` (arrows, Delete, Enter, Esc, ⌘A/⌘C/⌘V, hold L). The status bar
  under a graph shows the gestures for the current selection (`gestureHint` in `GraphView`).
- **UI text**: plain sentences, no jargon in tooltips; hints explain what a control does to the figure. British
  spelling on screen ("Color", "Color scale", "color map"); the data area of a layer is its "Figure size".
- **Inspector rows** must fit the inspector at its minimum width (260 px). A field with a set width keeps it
  (`.row .input[style*="width"]` is `flex: none`) and sliders and unsized fields take the slack, so do not put more
  fixed-width controls in a `Row` than fit; give a row of buttons or checkboxes the `wrap` prop; long labels wrap.
  After adding rows, check that nothing is cut off at 260 px (select each kind of object and open every section).
- **Graph view chrome**: the toolbar is one line that scrolls sideways when the window is narrow; tools for a
  multi-selection live in `.selection-bar`, laid over the top of the canvas so the figure does not jump; sizes and
  the layer-mode hint are in the status bar under the canvas (`.statusbar`, as in the sheet view).
- **Dev helpers** (browser preview only): `window.__store`, `__importFile`, `__svg`, `__raster`, `__layoutStats`,
  `__renderStats`, `__playback` (animation position: `seek(graphId, frame)`), `__animFrame`, `__animBlob`
  (encode an animation to a Blob), `__canMp4`.

## How to work on it

```bash
npm install
npm run dev                # Vite preview in the browser (file dialogs fall back to downloads)
npm run tauri dev          # native app with hot reload (needs Rust: ~/.cargo/bin on PATH)
npm run typecheck          # tsc --noEmit
npx vitest run             # unit tests (scales/breaks, layout cache, formulas, fitting, signal, export, animation, shortcuts)
npm run tauri build        # Mac → src-tauri/target/release/bundle/macos/PlotFolio.app
npm run tauri build -- --bundles nsis   # Windows → src-tauri/target/release/bundle/nsis/PlotFolio_<version>_x64-setup.exe
(cd src-tauri && cargo test --lib)      # the shell's own tests (command-line files, Windows path comparison)
```

Checklist for a change: typecheck, tests, exercise the feature in the preview (synthetic pointer events are fine;
the hidden browser pane throttles `requestAnimationFrame`, so do not await frames in scripts), compare export hashes
if rendering changed, rebuild the app. The owner tests the Mac app by hand; say what you could not verify.
`http://localhost:1420/?shell=windows` (dev server only) shows the Windows menus, key names and spacing in a
browser on any computer; it cannot show the Windows title bar, file dialogs or windows.

## Three builds: Mac, Windows, browser

One code base. `shell()` in `src/io/platform.ts` says which build is running; `isTauri()` only says whether there
is a desktop shell (files, windows, autosave on disk). Ask `isTauri()` for what the shell can do, and `shell()` /
`hasNativeMenu()` for how things look and where the menus are. `<html data-shell="mac|windows|browser">` carries
the same answer to `styles.css`.

| | Mac app | Windows app | Browser |
|---|---|---|---|
| Menus | native menu bar, `src-tauri/src/menu.rs` | drawn in the page: `WINDOWS_MENUS` in `menuModel.ts` (File … Help, Settings and Exit in File, Alt + first letter opens a menu, F10) | drawn in the page: `WEB_MENUS` (Mac-style, with a "PlotFolio" menu) |
| Shortcuts with ⌘ / Ctrl | the menu bar acts on them | the page (`shortcutKeys.ts`); Redo is Ctrl+Y, full screen F11, help F1 | the page, minus keys the browser keeps |
| Title bar | the toolbar row is the title bar (traffic lights, drag region, project name) | the Windows title bar, with the name as window title ("*Name - PlotFolio"); the toolbar row holds menus and buttons | none |
| First window | `tauri.conf.json` | the same with `tauri.windows.conf.json` merged over it | – |
| Open a project from outside | `RunEvent::Opened` | command line at start, `tauri-plugin-single-instance` afterwards | `?project=` URL |

Windows specifics, all in code comments where they live: `installWebviewKeyGuard` (`shortcutKeys.ts`) stops
WebView2's browser keys (F5 reload, Ctrl+P, Ctrl+F …), a lone Alt press and the web view's right-click menu;
`macWindowChrome` (`windows.ts`) keeps the Mac-only window options away from Windows; `joinPath` / `baseName`
(`platform.ts`) keep backslash paths intact; `allow_project_file` (`lib.rs`) lets the page read a project that
arrived by command line or the recent list from any drive. Target: Windows 10 and 11, 64-bit (Tauri 2.12 does not
run on Windows 7).

### Building and testing on a Windows PC

Needs Node 20 or later, Rust (`rustup`, the default MSVC toolchain) and the "Desktop development with C++" part of
the Visual Studio Build Tools. WebView2 is part of Windows 10/11.

```bash
npm install
npm test
npm run tauri dev                        # the app with hot reload
npm run tauri build -- --bundles nsis    # the installer, under src-tauri/target/release/bundle/nsis/
```

State on 2026-11-22: written and type-checked on a Mac (`cargo check --target x86_64-pc-windows-msvc`, unit tests,
the `?shell=windows` preview). **Nothing has run on Windows yet.** First things to check there, roughly by risk:

1. It builds, installs (SmartScreen: More info → Run anyway) and starts; the window has the Windows title bar and
   the File … Help row under it, with no empty strip at the left.
2. Double-click a `.plotproj` with PlotFolio closed, then another with it open (one app, second window or the
   blank window reused; the same file again brings its window forward).
3. Open and save on another drive or a network share; File ▸ Open Recent after a restart.
4. Menus by mouse, by Alt+F / E / D / A / G / V / H and F10, arrows, Enter, Esc. Alt+F4 and File ▸ Exit with
   unsaved changes ask first.
5. Ctrl+S / N / T / R / Y, F11, F1; F5 and Ctrl+R must not reload the page; right-click on empty areas shows no
   browser menu. Alt-drag on a layer zooms and the next key press is not swallowed; Ctrl+wheel zooms the canvas
   only.
6. New project window, pop-out window, a column dragged from a sheet window onto a graph window.
7. Copy as PNG / SVG, paste; export PNG, SVG, MP4, GIF, PNG frames into a folder; drop a CSV on the window.
8. Dark mode follows Windows; text and scroll bars at 125 % and 150 % display scaling.

Known and left alone: Helvetica and Helvetica Neue do not exist on Windows, so a figure that uses them is drawn
in the fallback font there (Arial).

## Where to add things

- A new plot style: `types.ts` (plot options) → `layout.ts` (geometry) → `plots2d.tsx`/`GraphSvg.tsx` (drawing) →
  `inspector/PlotTypeFields.tsx` (controls) → defaults in `defaults.ts`.
- A new axis option: `Axis` in `types.ts` → `scales.ts`/`axisGeom` in `layout.ts` → `AxisG` → axis rows in
  `GraphInspector.tsx`. Custom ticks (`customTicks`, `customTicksMode`) are merged into `scale.major` in
  `buildScale`; their labels travel as `scale.customLabels`.
- A whole-figure edit (every text style, every plot color): helpers in `src/model/figure.ts`, UI in the
  `FigureGroup` of the canvas inspector. Palettes are listed in `src/model/palettes.ts` (also used by Settings).
  Plot styles (`plotStyleOf` / `applyPlotStyle` / `applyStyleToPlots` and the style clipboard) live there too.
- Inspector sections: in a panel with tabs every titled `Group` folds; the open section per panel kind and tab is
  kept in `useInspectorSections` (localStorage, key `kind/tab`). Give a Group an `id` when its title changes with
  the selection or is not plain text. Plot and Axis panels apply edits to every co-selected object.
- Bars: width, stacking and direction are read from the first bar plot of the layer (`BarFields` writes them to
  all bar plots); per-plot color mode (plot / per category from `ll.palette` / color-by column), hatch patterns
  (`<pattern>` defs inside the plot group, ids from `barPatternId`) and value labels reuse `plot.labels`.
- A new drawn object: `ShapeKind` → `shapeGeometry`/`shapePointsMm` in `layout.ts` → `ShapeG` → `ShapeInspector`
  → drawing tool in `GraphView.tsx` (`drag.kind === "draw"`, `finishPoly`).
- The app icon: drawn by `scripts/make-icon.py` (two volcanoes as a 3D surface; its header lists the steps from
  the drawing to the icon files in `src-tauri/icons/`, and to `public/favicon.png` for the browser tab).
  The script also writes the same icon with fumes standing over the craters (`docs/icon/plotfolio-icon-fumes*.svg`):
  since 0.5.1 this is the icon of the apps, the browser tab and the README's install strip.
  `scripts/make-animated-icon.py` makes the moving version for web pages
  (`docs/icon/plotfolio-icon-animated.svg`, used on nirlivne.com and at the top of the README). The look of the fumes is set once, in
  `make-icon.py`. The animated icon is built on `docs/icon/plotfolio-icon-512.png`, the icon WITHOUT fumes: keep
  that file plain, or the moving fumes are drawn over still ones.
- The landing part of `README.md` (what a visitor of the GitHub page sees first): its pictures are in
  `docs/readme/`; the buttons and install strips are drawn by `scripts/make-readme-art.py`, whose header says how
  the others were made. GitHub shows only plain images and simple HTML there: no styles, no scripts.
- A new menu command: id in `menu.rs` (Mac menu bar) **and** in `src/app/menuModel.ts` (the menus the Windows app
  and the browser build draw with `MenuBar.tsx`; Data, Analysis and Graph are shared by both layouts, the other
  menus are written per layout) → `handleMenu` in `menu.ts`. Give the entry a default `keys` shortcut only if
  browsers let a page use it (not ⌘N/⌘T/⌘W/⌘R/⌘L/⌥⌘I); a default for the desktop apps only goes in
  `DESKTOP_DEFAULTS` in `shortcuts.ts`. Nothing else is needed for the key: see Shortcuts below.
  Browser Edit commands (cut/copy/paste/select all) go through `editCommand` in `menu.ts`; sheet paste uses
  `sheetPasteRef` because the grid ignores synthetic paste events.
- A new analysis: `signal.ts` + `ops.tsx`, then `CurveAnalysisDialog.tsx` (from a graph, the main way) and
  `AnalysisDialog.tsx` (from a sheet); menu id `an:<op>` in both menus and in `GRAPH_OPS` (`analysis/start.ts`).
- A new tile in the Plot Columns gallery: an entry in `PLOT_KINDS` (`plotKinds.ts`; `apply` turns a new plot of the
  type into the variant) and a picture in `PlotKindIcon.tsx`. `store.plotColumns` / `addPlot` take the same `apply`;
  keep `previewGraph` (`sheet/plotPreview.ts`) in step with what they do, since it builds the preview the same way.
- Box-type plots have three styles (`plot.box.style`: box, violin, points), all `type: "box"`, so categories, extents
  and brackets work for each; the violin outline is `density()` in `graph/violin.ts` (cached on `BoxStats.values`).
  A CDF is a histogram with `histogram.display: "cdf"`: `histogramBins` then returns one step per distinct value.
- A new statistical test: the maths in `compare.ts` (+ `distributions.ts`), a reference case from SciPy in
  `compare.reference.json` / `compare.test.ts`, then a choice in `CompareDialog.tsx`. Brackets are shapes of kind
  `bracket` (label, `labelStyle`, tick length in `headSizeMm`); those attached to the axes (`coord: "data"`) count
  towards the automatic range of the value axis (`plotAxisExtent`), with room for the label.
- Legend entries: `legend.showActive` lists every visible plot and ignores `plot.showInLegend` (`legendGeom`).
  A double-click on the legend edits the entry under the pointer in place (`legendEntryAt`): the press captures
  the pointer on the whole legend, so the handler sits on the legend and not on its entries.
  Their order is the drawing order unless plots carry a `legendRank` (`legendOrder` / `moveLegendEntry` in
  `model/figure.ts`, arrows in Legend ▸ Entries); the rank lives on the plot so copies keep it.
- Outside the canvas: objects may stand outside the page. On screen the SVG overflows its box, a pale sheet
  (`.graph-desk`) lies under the off-page content, a veil in the desk color (`.ui-off-page`) fades it, and the scroll
  area grows to reach it (`desk` in `GraphView.tsx`). Exports never contain it: `layoutToSvg` passes every layout
  (stills and animation frames) through `pageContent` (`layout.ts`), which drops layers with nothing on the page and
  single texts, shapes, legends and color scales that lie wholly outside. What crosses the edge is kept whole.
  An automatic canvas height ignores layers parked beside the page.
- A press on a layer's empty background goes to an object of another layer lying under it there (text, shape,
  legend, color scale, line or scatter curve): `objectUnder` in `GraphView.tsx`, for presses and double-clicks.
  Plots that fill their frame (heatmap, bars) do not take the press, so an inset over them still selects.
- Color scale: `colorScale.tickStep` / `decimals` (null = automatic; the automatic step widens until the labels
  clear each other, `colorScaleStep` in `layout.ts`). Its panel also shows the color map fields of the plot it
  draws (`ColormapFields`), so range and map can be changed from the bar.
- Lists that can be reordered are also reordered by dragging a row: `ui/reorder.ts` (`reorderRow(scope, id, onMove)`
  spread on each row; pointer events, an insertion line, Esc cancels). Used by the plot list (plots and groups among
  the blocks, curves inside their group), legend entries, the build-up order, the sheet's column list, the layer
  list of a figure (`moveLayer`) and the tabs (`moveTab`, sideways). A new list with an order gets the same: mark its
  rows and give `onMove(from, to)`. The project list in the sidebar has its own drag (`Sidebar.tsx`, `dropAt`): a
  row dropped between rows of its kind goes there and takes that row's folder (`placeItem`, `placeFolder`), a row
  dropped on a folder goes into it.
- Curve groups: everything that changes membership, order or colors goes through `model/plotGroups.ts` inside a
  store update (`updateGraph`), and `tidyGroups` then enforces the rules: members sit together in `layer.plots`, a
  group with `colors` overrides `plot.color`, empty groups disappear. Layer copies keep `groupId` (a copy inside the
  same figure joins the group; one pasted into another figure leaves it). Nothing in the renderer knows about groups.
- Right-click ▸ Copy to new figure: `store.copyToNewGraph(graphId, layerIds, plotIds?)` — layers with their texts,
  shapes, legends and groups, moved to the corner of a canvas that fits (`layout.content`); the animation is not copied.
- A new animation effect or option: the effect's fields in `Animation` (`types.ts`, with a default in
  `defaultAnimation`) → what it changes per frame in `frameLayer` (`animation.ts`; add to `LayerAnim` only what the
  renderer cannot derive) → drawing guarded by `ll.anim` in `GraphSvg.tsx` / `Layer3D.tsx` → controls in
  `AnimationFields.tsx` → a case in `animation.test.ts`. Check that the export hashes did not move.
