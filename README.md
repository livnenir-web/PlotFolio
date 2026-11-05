# PlotFolio

Sheet-based plotting, curve fitting and publication-quality figure export — the parts of Origin that matter, rebuilt as a native Mac app (Tauri 2 + React + TypeScript) that also runs in the browser.

## Features

- **Sheets** — columns with long name, units, comments and X/Y/error designations; type, paste from Excel/Numbers, import CSV/TSV/Excel (drag a file onto the window). Column formulas in plain math: `B*2`, `log10(A)`, `(C-mean(C))/std(C)`; `i` is the row index. Sparklines in the header.
- **Graphs** — one canvas holds any number of layers (sets of axes). Layers are dragged, resized, aligned with smart guides, arranged on a grid, grouped, duplicated, copied and pasted between graphs. Click an element to edit it in the inspector; double-click titles and legend entries to edit them in place.
- **Plot types** — symbols, lines, line + symbol, error bars (bars or shaded bands), histograms, bars (grouped/stacked, per-category colours, hatching, value labels), box plots, heatmaps with interpolation and colour levels, contours, 3D surfaces and scatter, functions y = f(x).
- **Axes** — linear/log, auto or manual range, reversed, major ticks by step or count, custom ticks with their own labels, prefix/suffix, label angle, number formats (fixed, scientific, 1e3, SI prefixes, thousands separators), axis breaks with per-segment scales, mirror (box) frame, second Y axis, axes crossing at a value, markup in titles (`\alpha`, `x^{2}`, `A_{0}`, `\it{...}`).
- **Annotations** — texts, lines, arrows, rectangles with rounded corners, ellipses, polylines, polygons and free-form strokes with adjustable smoothing, embedded pictures with cropping.
- **Fitting and analysis** — linear, polynomial, exponential, Gaussian, Lorentzian, power law, sigmoid, Hill, sine or any custom expression; parameters ± standard errors, R², reduced χ², weighting by error bars, confidence and prediction bands, residual plot, report sheet, fits that re-run when the data changes. Smoothing, derivative, integral, FFT, normalise, average and interpolate curves.
- **Whole-figure edits** — one font, text size or colour for every text; 13 colour palettes; apply a plot's style to a layer or a graph; copy and paste styles.
- **Export** — SVG at the physical size (mm) with semantic groups and no background; PNG/JPEG at any DPI; copy as SVG/PNG.
- Sizes are in mm, fonts and lines in pt. Defaults: 50 × 50 mm data area on an 87 mm canvas, Arial 9/8 pt, 0.5 pt axes, Okabe-Ito colours. Change them in Settings (⌘,).

## Run it

### Mac app

```bash
npm install
npm run tauri build
```

The app lands in `src-tauri/target/release/bundle/macos/PlotFolio.app`. It is unsigned: the first time, right-click → Open. Requires Node ≥ 20 and Rust (`curl https://sh.rustup.rs -sSf | sh`).

### In the browser

```bash
npm install
npm run dev
```

Everything works in the browser except the native parts: "Open" uses a file picker, "Save" and exports download files, and there is no menu bar (the toolbar and keyboard shortcuts cover the same commands). Projects stay in the page; download them to keep them.

### Host it on a website

`npm run build` writes a static site to `dist/`. Copy that folder anywhere on your site (asset paths are relative, so a sub-folder such as `https://example.org/plotfolio/` works) — no server-side code is needed.

- `public/samples/` holds the sample projects and `index.json` lists them; they appear under the **Samples** button. Add your own `.plotproj` files there.
- Link straight to a sample: `https://example.org/plotfolio/?sample=xy-and-fits`
- Open any project by URL (same origin, or a server that allows cross-origin requests): `https://example.org/plotfolio/?project=https://example.org/data/figure.plotproj`

## Project files

`.plotproj` files are plain JSON holding every sheet, graph, folder, the default style and the last view. The Mac app keeps an autosave in the app data folder and offers it for recovery on the next start.

## Development

```bash
npm run tauri dev      # native app with hot reload
npm run dev            # frontend only, in the browser
npm test               # unit tests
npm run typecheck
```

`AI_NOTES.md` describes the code for an AI assistant or a new contributor; `INSPECTOR_ROADMAP.md` lists planned refinements.
