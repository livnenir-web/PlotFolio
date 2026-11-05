# Inspector roadmap — improvements, refinements and additions for future versions

Review of the inspector panel on 2026-11-05 (after the sections became collapsible). File abbreviations:
`GI` = src/graph/inspector/GraphInspector.tsx, `PTF` = PlotTypeFields.tsx, `BE` = BreaksEditor.tsx,
`PSF` = PlotSourceFields.tsx, `INS` = src/app/Inspector.tsx, `SET` = src/app/SettingsDialog.tsx,
`T` = src/model/types.ts, `F` = src/ui/Fields.tsx. "Missing" items were checked against the types and the
renderer, not only the JSX. Line numbers drift; search for the quoted text.

## Top 10 by value for publication figures

1. **Apply plot style to all plots (layer / graph) and copy–paste style** — every curve is styled by hand today.
2. **Axis "Tick labels" section** with a Reverse checkbox (scales already support it), exponent / SI / thousands formats, label gap and label skip; split from the 13-row Scale section.
3. **Opacity on lines and marker fills** — no way to show overlapping data or dense scatter.
4. **Grid styling and minor grid** — colour, width and dash are hard-coded.
5. **Legend frame, background, title, corner anchoring, entry order** — fixed black 0.5 pt frame, white fill, top-left mm positioning.
6. **Text background box and a markup toolbar** — labels over data; discoverable super/subscript.
7. **Opposite-side tick labels / top X axis** — twin axes (wavelength vs energy); mirror draws ticks only.
8. **Colour scale: own number format, orientation, an Add button** — its labels silently follow the X axis format.
9. **Bars: per-bar colours, hatching, value labels; make arrangement truly layer-wide** — edits on a non-first bar plot do nothing.
10. **More project defaults plus "apply defaults to this graph"** — mirror / in-ticks / format / legend frame set once per lab style.

## Cross-panel

Refine
- Units are shown three ways: in the label (`Width (pt)`), as a trailing hint (`mm`), or only in a tooltip (Tick length). Pick one convention.
- Paired number fields (From·To, W×H, X·Y, tick lengths, length·width, columns·padding) have no placeholders; NumberField supports them.
- The row label column is 82 px with ellipsis; "Columns · padding", "Rounded corners", "Decimals · size", "Prefix · suffix" truncate. Widen or shorten.
- "Color" and "Colour" are both used on screen. Pick one.
- Untitled groups are not collapsible, so "Axis visible", "Delete text", "Delete shape" float at the bottom. Give every panel one consistent Actions footer or move them into the head.
- Tooltips exist on roughly 15 of 150 rows; Title gap, Symbol width, Mesh every, Group width, Box width, Grid points, Crop have none.

Usability
- No "reset this field to default"; GraphDefaults exists so a per-row reset is cheap.
- ColorField is a native swatch plus hex; no recent colours, no palette swatches, no "none" for strokes.
- The accordion is strictly one-open-per-panel; common pairs (Symbol + Line, Stroke + Fill, Legend + Entries) can never be seen together. Consider ⌥-click to open several, or merge those pairs.
- Number fields step by 1 with the arrow keys even for widths; no Shift-arrow ×10.
- Only Layer, Legend, Shape and Text honour the multi-selection; Plot and Axis edit one object.

## Canvas

Missing
- Canvas margin is a constant (2 mm) used by "Fit canvas to content"; not editable.
- No page presets (87 / 136 / 180 mm journal columns, A4, Letter).
- No grid / snap settings (spacing, on/off, rulers); smart snapping has no user control.
- No canvas-level texts or shapes; a figure title or (a)/(b) labels must belong to a layer.
- Layers list has no reorder, visibility toggle, lock or duplicate.

Refine
- Height is disabled by Auto height, which sits two rows below; put "Auto" on the Height row.
- "Fit canvas to content" silently switches Auto height off; say so.
- Export is a one-button section; move it to the head.
- "Figure size", "Data area", "Area offset" naming conflicts; use "Data area" everywhere.

## Whole figure

Missing
- No whole-figure line widths, tick lengths, marker sizes, or "scale everything by %" for moving between column widths.
- No per-class font edit (tick labels only / titles only / legends only).
- No "apply project defaults to this graph" / "make this graph the project default" for the full style.

Refine
- Text colour swatch shows black when colours are mixed; show an empty/mixed swatch.
- The swatch strip shows the project palette when no palette matches; show the actual plot colours.
- "all = …" placeholder is cryptic; "Set all to".
- Tooltip says "Settings ▸ Colors"; the Settings row is "Palette".
- Swatch rows use margin 88 px while labels are 82 px.

## Layer

Missing
- Plot-area background fill and frame border colour.
- Lock, per-layer visibility, z-order across layers.
- Axis linking between layers (shared X across panels).
- "Same size/position as layer N" and "Arrange in grid" from the inspector.
- "Add panel label (a), (b)".
- "Exchange X and Y".
- "Add colour scale" button: the section appears only when a colour scale already exists, yet the Colour-by hint sends users there.

Refine
- "Apply axis style to all layers" also overwrites the legend style and skips number format, decimals, rotation, prefix/suffix; neither is said.
- Multi-selection: "Remove right Y axis" acts on every selected layer; the hint is inside a collapsed section.
- Delete is disabled with one layer, no tooltip.
- Legend and Colour scale sections are one checkbox plus a button each; merge or drop.
- Plots and Add plot are separate sections; merge with an Add button in the header.
- The Axes list shows only the scale type; show range/auto too.

Usability
- Default-open "Layer" holds only a Name field; make the name editable in the head and default-open "Data area".
- Duplicate/Copy/Delete belong in the head or a footer.
- Plots list: no drag reorder, no multi-select.

## Axis

Missing
- Reverse checkbox (from > to already works in scales).
- Opposite-side tick labels / top X axis / right-labelled Y; no x2 axis.
- Axis offset (outward spine); ticks-only-opposite without a line.
- Minor grid; grid colour/width/dash; grid on top.
- Number formats: 1e3 style, engineering / SI prefixes, thousands separator, percent, trailing-zero trimming, date/time axes.
- Log minor tick labels (2, 5).
- Tick label gap, label skip (every nth), label wrap.
- Title alignment, horizontal Y title, title offset along the axis.
- Tick line width and tick colour separate from the axis line.
- Auto-range padding % / tight vs nice; range from visible plots only.
- Break marker styles (slanted, zigzag).
- Axis end arrows.

Refine
- "Minor ticks" sits in Scale but is greyed by "Same style as X" from Style, without a hint.
- Scale is 13 rows; split into Scale (type, range, major/minor) and Tick labels (format, decimals, show, prefix/suffix, angle, custom ticks).
- Row "Labels" is the number format; rename "Number format".
- "Special ticks" → "Custom ticks" (matches the type name).
- "Tick length" has two unlabelled fields; "Line (pt)" paints ticks too; label "Line & ticks".
- The markup hint appears only here; share it as a tooltip on the symbol picker.
- Style packs tick settings and two full font blocks (14 rows); split "Fonts" out.
- Z axis: geometry is undefined so Auto-range From/To show stale numbers; Breaks are offered for z and y2 untested.
- Auto range is a label-less row above From·To; put it on that row.
- Segment 1 of a break is editable both in Scale and in the Breaks editor.
- Label angle as a segmented 0 / 45 / 90 or slider.

Usability
- Order: Scale, Tick labels, Style, Fonts, Title, Breaks.
- No "apply this style to the other axes of this layer" from the Axis panel.
- No live sample of the tick label format.

## Plot — common

Missing
- Opacity for lines and marker fills.
- Marker skip / every nth point; marker size by column (bubble); marker shape by column.
- Line cap/join; area fill under a curve or between curves; more marker shapes (star, hexagon, down/left/right triangles, half-filled); "none" exists in the type but is not offered.
- Z-order on the Plot panel.
- "Show in legend" on the Plot panel (only in Legend ▸ Entries).
- Error bars: plus-only / minus-only, asymmetric (two columns), colour for bar style, cap style, draw behind symbols, errors from replicate columns (SD/SEM).
- Drop line style (colour/width/dash).
- Data labels: font/colour/bold, number format beyond decimals, prefix/suffix, rotation, first/last/min/max only, leader lines.
- Fit curve: extend to the axis range; band colour/opacity; "show equation on graph".
- Function plot: Symbol section is offered though rarely wanted; no parameter sliders.
- Per-plot "clip to frame".
- Apply this plot's style to all plots; copy/paste style.

Refine
- Type labels "Symbol / Line / Both" vs the Add-plot list "Symbol / Line / Line + symbol"; cannot convert to bar/histogram here.
- Symbol: "Filled" sits on the Size row while fill colour is two rows above; edge width "auto" needs a tooltip; unit shown two ways.
- Error bars "Cap (mm)" row also holds the line width; band outline width reuses the bar width field.
- Colour by column and the Colormap section it adds are two sections for one feature.
- Source also holds "Fit a curve…" and "Remove plot"; move Remove to the head, Fit to the Plot section.
- Fit summary lacks adjusted R², N, DOF (only in Copy results).
- Heatmap, contour and box plots are silently excluded from the legend.

Usability
- A scatter plot has up to 9 sections; merge Symbol + Line into "Style", and Data labels + Drop lines + Colour by into "Extras".
- Default-open "Plot" (name/type/colour/visible) is the least-edited section; default to Style.
- Opacity, label angle, box/bar width are slider candidates (reuse the Smoothing slider + number pattern).

## Plot — by type

Missing
- Histogram: cumulative, step/outline-only, bin alignment/offset, edge colour/width, bar gap, mean/median overlay.
- Bar: per-bar colour / colour column, hatching for B/W print, outline colour/width (fixed black 0.5 pt), within-group gap, baseline value, value labels, error bar direction.
- Box: notch, whisker cap width, separate fill/outline colour, violin or jitter amount, median line style, mean symbol, unit on "Width".
- Heatmap: NaN colour, out-of-range colour, cell outline, equal-aspect lock, transpose.
- Contour: label font size fixed 6 pt and format fixed; label font/decimals/placement, line width per level, label every nth level.
- Colormap: preview strip in the picker, centre-at-zero for diverging maps, percentile range, custom stops interpolate in RGB only.
- Surface: colour-by-Z vs flat colour, opacity, light direction; 3D scatter: size by column, projections onto panes.
- 3D view: orthographic/perspective toggle.

Refine
- Bar hint says settings come from the first bar plot: edits on another bar plot do nothing. Write to every bar plot or move Arrange/Direction to the Layer panel.
- Contour "Levels" and Colormap "Levels" appear together; rename the latter "Colour bands".
- Colormap "Logarithmic" vs axis "Log₁₀"; align wording.
- Matrix "Z columns" and Colormap "Range" are unlabelled pairs.
- Histogram repeats the Auto-range-row-then-From·To pattern; same fix as Axis.

## Legend

Missing
- Title; frame line width and colour; background colour and opacity; corner radius.
- Entry order independent of drawing order.
- Per-entry symbol (line only / marker only), symbol length per entry, row spacing, column gap, fill direction.
- Anchoring to a frame corner / outside the frame / auto placement; today top-left mm only.
- One combined legend for several layers.
- Box plots in the legend.

Refine
- "White background" → "Background" once a colour exists.
- "Symbol width" → "Symbol length".
- "Columns · padding" two unlabelled fields, one "mm" hint.
- FontFields inside Legend makes 9 rows; split "Font".
- Entries use a swatch as the row label, wasting the label column.

## Colour scale

Missing
- Orientation (always vertical).
- Own number format / decimals / major step: ticks are built from a copy of the X axis, so the X format leaks in.
- Label side, tick length/direction, outline width, title position, units suffix, which plot it represents, out-of-range triangles.

Refine
- "Length · width" unlabelled pair.
- Head icon is the legend icon.

## Shape

Missing
- Rotation for rect/ellipse/image.
- Width × height fields for rect/ellipse (only corners).
- Arrow head styles (open/filled/bar/circle), head width vs length, heads on polylines.
- Stroke opacity, shadow, line cap/join, hatching.
- Vertex editing for polyline/polygon (list, add/remove, open↔closed).
- Lock position / keep proportions for non-images.
- Align/distribute controls in the inspector.
- Duplicate button; text inside a shape (callout).

Refine
- Fill default colour hard-coded blue; use the stroke colour or the first palette colour.
- Rounded-corner slider max 20 mm fixed; scale to the shape.
- Stroke and Fill are separate sections; merge into "Appearance".
- Crop label "Trim edges on the canvas" → "Crop on canvas" with a tooltip.

## Text

Missing
- Background box / border / padding.
- Vertical anchor; line spacing; width/wrapping.
- Markup toolbar (B / I / U / x² / x₀ / Greek); ⌘B/⌘I/⌘U exist but are undiscoverable.
- Opacity; rotation presets; lock; duplicate.
- Dynamic text linked to data (fit parameters, cell values).

Refine
- "Align" sets the anchor, not paragraph alignment; label "Anchor".
- Rotation as segmented or dial.
- Merge Text and Font sections.

## Column / Sheet

Missing
- Column comment is stored and shown in the grid but not editable here.
- Display format, data type, column width, "set as X for the following Y columns".
- Statistics: median, SEM, missing count, Copy button.
- Sheet inspector: row/column counts, notes, folder, Add column, Export CSV, import source.

Refine
- Head shows "Column A"; add the long name.
- "Plot as" option "Label" is unexplained.

## Settings

Missing
- Defaults for mirror/box frame, grid, number format/decimals, title gap, legend border/background/symbol length, error-bar cap/width, marker shape, default colormap, canvas height, text-label font, shape stroke.
- "Apply these defaults to this graph" and "Make this graph the project default".
- App-level defaults for new projects; theme export/import.

Refine
- "JPEG quality 92%" is a checkbox toggling 0.92/0.8; make it a number.
- "Line (pt)" appears twice; "Axis line" / "Plot line".
- Unlabelled pairs: Data area, Area offset, Tick length.
- Palette swatch inputs misaligned by 6 px.
