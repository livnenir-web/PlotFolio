use std::sync::Mutex;
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// The "Open Recent" submenu, so its items can be replaced at runtime.
pub struct RecentMenu(pub Mutex<Option<Submenu<Wry>>>);

fn file_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

/// Replace the items of the "Open Recent" submenu with the given paths.
pub fn set_recent(app: &AppHandle, paths: Vec<String>) -> tauri::Result<()> {
    let state = app.state::<RecentMenu>();
    let guard = state.0.lock().unwrap();
    let Some(sub) = guard.as_ref() else { return Ok(()) };
    for it in sub.items()? {
        sub.remove(&it)?;
    }
    if paths.is_empty() {
        sub.append(&MenuItemBuilder::with_id("recent:none", "No Recent Projects").enabled(false).build(app)?)?;
        return Ok(());
    }
    for p in &paths {
        sub.append(&MenuItemBuilder::with_id(format!("recent:{}", p), file_name(p)).build(app)?)?;
    }
    sub.append(&PredefinedMenuItem::separator(app)?)?;
    sub.append(&MenuItemBuilder::with_id("recent:clear", "Clear Menu").build(app)?)?;
    Ok(())
}

fn item(app: &AppHandle, id: &str, label: &str, accel: Option<&str>) -> tauri::Result<tauri::menu::MenuItem<Wry>> {
    let mut b = MenuItemBuilder::with_id(id, label);
    if let Some(a) = accel {
        b = b.accelerator(a);
    }
    b.build(app)
}

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let about = AboutMetadataBuilder::new()
        .name(Some("PlotFolio"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some("Sheet-based plotting, fitting and publication-quality export."))
        .build();

    let app_menu = SubmenuBuilder::new(app, "PlotFolio")
        .about(Some(about))
        .separator()
        .item(&item(app, "settings", "Settings…", Some("Cmd+,"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&item(app, "quit", "Quit PlotFolio", Some("CmdOrCtrl+Q"))?)
        .build()?;

    let recent = SubmenuBuilder::new(app, "Open Recent")
        .item(&MenuItemBuilder::with_id("recent:none", "No Recent Projects").enabled(false).build(app)?)
        .build()?;
    *app.state::<RecentMenu>().0.lock().unwrap() = Some(recent.clone());

    let import_menu = SubmenuBuilder::new(app, "Import")
        .item(&item(app, "import", "Data (CSV, TSV, Excel)…", Some("CmdOrCtrl+I"))?)
        .item(&item(app, "importImage", "Image onto Graph…", None)?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item(app, "new", "New Project", Some("CmdOrCtrl+N"))?)
        .item(&item(app, "open", "Open…", Some("CmdOrCtrl+O"))?)
        .item(&recent)
        .separator()
        .item(&item(app, "save", "Save", Some("CmdOrCtrl+S"))?)
        .item(&item(app, "saveAs", "Save As…", Some("CmdOrCtrl+Shift+S"))?)
        .separator()
        .item(&import_menu)
        .item(&item(app, "exportGraph", "Export Graph…", Some("CmdOrCtrl+Shift+E"))?)
        .item(&item(app, "exportCsv", "Export Sheet as CSV…", None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some("Close Window"))?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item(app, "undo", "Undo", Some("CmdOrCtrl+Z"))?)
        .item(&item(app, "redo", "Redo", Some("CmdOrCtrl+Shift+Z"))?)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&item(app, "delete", "Delete", None)?)
        .build()?;

    let data = SubmenuBuilder::new(app, "Data")
        .item(&item(app, "newSheet", "New Sheet", Some("CmdOrCtrl+T"))?)
        .item(&item(app, "plot", "Plot Columns…", Some("CmdOrCtrl+P"))?)
        .item(&item(app, "stats", "Column Statistics", None)?)
        .separator()
        .item(&item(app, "addColumn", "Add Column", None)?)
        .item(&item(app, "sortAsc", "Sort Ascending", None)?)
        .item(&item(app, "sortDesc", "Sort Descending", None)?)
        .build()?;

    let analysis = SubmenuBuilder::new(app, "Analysis")
        .item(&item(app, "fit", "Fit Curve…", Some("CmdOrCtrl+F"))?)
        .separator()
        .item(&item(app, "an:smooth", "Smooth…", None)?)
        .item(&item(app, "an:derivative", "Differentiate", None)?)
        .item(&item(app, "an:integrate", "Integrate", None)?)
        .item(&item(app, "an:normalize", "Normalize…", None)?)
        .item(&item(app, "an:fft", "FFT…", None)?)
        .separator()
        .item(&item(app, "an:average", "Average Curves…", None)?)
        .item(&item(app, "an:interpolate", "Interpolate onto X…", None)?)
        .separator()
        .item(&item(app, "an:fill", "Fill Column With…", None)?)
        .item(&item(app, "stats", "Column Statistics", None)?)
        .build()?;

    let graph = SubmenuBuilder::new(app, "Graph")
        .item(&item(app, "newGraph", "New Graph", Some("CmdOrCtrl+Shift+N"))?)
        .item(&item(app, "addLayer", "Add Layer", Some("CmdOrCtrl+L"))?)
        .item(&item(app, "addText", "Add Text", None)?)
        .item(&item(app, "insertFunction", "Insert Function…", None)?)
        .separator()
        .item(&item(app, "draw:line", "Draw Line", None)?)
        .item(&item(app, "draw:arrow", "Draw Arrow", None)?)
        .item(&item(app, "draw:rect", "Draw Rectangle", None)?)
        .item(&item(app, "draw:ellipse", "Draw Ellipse", None)?)
        .separator()
        .item(&item(app, "rescale", "Rescale Axes to Data", Some("CmdOrCtrl+R"))?)
        .separator()
        .item(&item(app, "copySvg", "Copy as SVG", None)?)
        .item(&item(app, "copyPng", "Copy as PNG", None)?)
        .separator()
        .item(&item(app, "popOut", "Open in New Window", Some("CmdOrCtrl+Shift+O"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item(app, "toggleSidebar", "Toggle Sidebar", Some("CmdOrCtrl+Alt+S"))?)
        .item(&item(app, "toggleInspector", "Toggle Inspector", Some("CmdOrCtrl+Alt+I"))?)
        .separator()
        .item(&item(app, "zoomIn", "Zoom In", Some("CmdOrCtrl+Plus"))?)
        .item(&item(app, "zoomOut", "Zoom Out", Some("CmdOrCtrl+-"))?)
        .item(&item(app, "zoomFit", "Zoom to Fit", Some("CmdOrCtrl+0"))?)
        .separator()
        .fullscreen()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().separator().close_window().build()?;

    let about_menu = SubmenuBuilder::new(app, "About")
        .item(&item(app, "about", &format!("About PlotFolio {}", env!("CARGO_PKG_VERSION")), None)?)
        .item(&item(app, "aiNotes", "Notes for AI Assistants…", None)?)
        .build()?;

    let menu = Menu::with_items(app, &[&app_menu, &file, &edit, &data, &analysis, &graph, &view, &window, &about_menu])?;
    Ok(menu)
}

pub fn on_event(app: &AppHandle, id: &str) {
    let _ = app.emit("menu", id.to_string());
}
