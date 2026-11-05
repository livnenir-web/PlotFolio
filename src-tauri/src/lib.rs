mod menu;

#[tauri::command]
fn force_quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Project files macOS asked us to open (Finder double-click) before the webview was ready.
pub struct PendingOpen(pub std::sync::Mutex<Vec<String>>);

/// Which project file each project window shows (label → path), so a file is never opened twice.
pub struct OpenFiles(pub std::sync::Mutex<std::collections::HashMap<String, String>>);

#[tauri::command]
fn set_window_file(window: tauri::Window, state: tauri::State<OpenFiles>, path: Option<String>) {
    let mut m = state.0.lock().unwrap();
    match path {
        Some(p) => {
            m.insert(window.label().to_string(), p);
        }
        None => {
            m.remove(window.label());
        }
    }
}

#[tauri::command]
fn window_for_file(state: tauri::State<OpenFiles>, path: String) -> Option<String> {
    state.0.lock().unwrap().iter().find(|(_, p)| **p == path).map(|(l, _)| l.clone())
}

/// Tell macOS about a document so it appears under "Recent" in the Dock menu and Finder.
#[cfg(target_os = "macos")]
fn note_recent(path: String) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSDocumentController;
    use objc2_foundation::{NSString, NSURL};
    if let Some(mtm) = MainThreadMarker::new() {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
        let dc = NSDocumentController::sharedDocumentController(mtm);
        dc.noteNewRecentDocumentURL(&url);
    }
}

#[tauri::command]
fn note_recent_document(app: tauri::AppHandle, path: String) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(move || note_recent(path));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, path);
}

/// Project windows are "main" and "project-*"; pop-outs carry their parent in the label ("<parent>--graph-<id>").
fn is_project_window(label: &str) -> bool {
    !label.contains("--")
}

#[tauri::command]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[tauri::command]
fn set_recent_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    menu::set_recent(&app, paths).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .manage(menu::RecentMenu(std::sync::Mutex::new(None)))
        .manage(PendingOpen(std::sync::Mutex::new(Vec::new())))
        .manage(OpenFiles(std::sync::Mutex::new(std::collections::HashMap::new())))
        .invoke_handler(tauri::generate_handler![force_quit, set_recent_files, take_pending_open, set_window_file, window_for_file, note_recent_document])
        .menu(|app| menu::build(app))
        .on_menu_event(|app, event| menu::on_event(app, event.id().0.as_str()))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            use tauri::Manager;
            match event {
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    use tauri::Emitter;
                    let paths: Vec<String> = urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().to_string()).collect();
                    if paths.is_empty() {
                        return;
                    }
                    // one project window decides what to do: the focused one, else "main", else any
                    let windows = app.webview_windows();
                    let mut target: Option<String> = None;
                    for (label, w) in windows.iter() {
                        if is_project_window(label) && w.is_focused().unwrap_or(false) {
                            target = Some(label.clone());
                            break;
                        }
                    }
                    if target.is_none() && windows.contains_key("main") {
                        target = Some("main".to_string());
                    }
                    if target.is_none() {
                        target = windows.keys().find(|l| is_project_window(l)).cloned();
                    }
                    match target {
                        Some(label) => {
                            let _ = app.emit_to(label.as_str(), "open-file", paths);
                        }
                        None => {
                            // still starting up: the first window picks it up
                            app.state::<PendingOpen>().0.lock().unwrap().extend(paths);
                        }
                    }
                }
                tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } => {
                    app.state::<OpenFiles>().0.lock().unwrap().remove(&label);
                }
                _ => {}
            }
        });
}
