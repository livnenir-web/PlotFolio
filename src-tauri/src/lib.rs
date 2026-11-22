// The native shell of PlotFolio. One code base for the Mac app and the Windows app; what differs:
//  - menus: the Mac app has the system menu bar (menu.rs). The Windows app has none here: the page draws its own
//    under the Windows title bar (src/app/menuModel.ts, MenuBar.tsx).
//  - opening a project from outside: macOS sends an "opened" event (Finder, the Dock); Windows starts the program
//    again with the file on the command line, which the single-instance plugin hands to the running app.
//  - the first window: tauri.conf.json (Mac look), with tauri.windows.conf.json merged over it on Windows.
#[cfg(target_os = "macos")]
mod menu;

#[tauri::command]
fn force_quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Project files the system asked us to open before a window was ready to take them: a double-click in Finder on
/// a Mac, the file named on the command line on Windows (how Explorer passes a double-clicked file).
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
    let key = path_key(&path);
    state.0.lock().unwrap().iter().find(|(_, p)| path_key(p) == key).map(|(l, _)| l.clone())
}

/// The form in which two spellings of one file compare equal. Windows ignores case and takes either slash, so
/// "D:/Lab/Run.plotproj" and "d:\lab\run.plotproj" are one file there; elsewhere a path is taken as written.
fn path_key(path: &str) -> String {
    if cfg!(windows) { windows_path_key(path) } else { path.to_string() }
}

fn windows_path_key(path: &str) -> String {
    path.replace('/', "\\").to_lowercase()
}

fn is_project_file(path: &str) -> bool {
    path.to_lowercase().ends_with(".plotproj")
}

/// The project files among command-line arguments, as full paths (`cwd` completes relative ones). Options and
/// anything that is not a project are skipped. `args` is without the program's own name.
fn project_files_in(args: impl IntoIterator<Item = String>, cwd: &std::path::Path) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.starts_with('-') && is_project_file(a))
        .map(|a| if std::path::Path::new(&a).is_absolute() { a } else { cwd.join(&a).to_string_lossy().to_string() })
        .collect()
}

/// Let the page read and write this project file wherever it lives. On its own the page may only touch the home
/// folder, the app's data folder and external volumes (capabilities/default.json), plus what the user picks in a
/// file dialog or drops on a window. A project named on the command line or in the recent list arrives by neither
/// way, and on Windows it is often on another drive (D:\, a network share).
fn allow_project_file(app: &tauri::AppHandle, path: &str) {
    use tauri_plugin_fs::FsExt;
    if !is_project_file(path) {
        return;
    }
    if let Some(scope) = app.try_fs_scope() {
        let _ = scope.allow_file(path);
    }
}

/// The project window that takes a request from outside: the focused one, else "main", else any.
fn target_window(app: &tauri::AppHandle) -> Option<String> {
    use tauri::Manager;
    let windows = app.webview_windows();
    for (label, w) in windows.iter() {
        if is_project_window(label) && w.is_focused().unwrap_or(false) {
            return Some(label.clone());
        }
    }
    if windows.contains_key("main") {
        return Some("main".to_string());
    }
    windows.keys().find(|l| is_project_window(l)).cloned()
}

/// Hand project files to a project window, which opens them (in itself when blank, else in a new window; a file
/// that is already open comes to the front). With no window yet, the first one picks them up when it has loaded.
fn deliver_open(app: &tauri::AppHandle, paths: Vec<String>) {
    use tauri::{Emitter, Manager};
    if paths.is_empty() {
        return;
    }
    for p in &paths {
        allow_project_file(app, p);
    }
    match target_window(app) {
        Some(label) => {
            let _ = app.emit_to(label.as_str(), "open-file", paths);
        }
        None => app.state::<PendingOpen>().0.lock().unwrap().extend(paths),
    }
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
    // the list is the page's own (it draws File ▸ Open Recent itself on Windows); here its files are made
    // readable, and the Mac menu bar gets its copy
    for p in &paths {
        allow_project_file(&app, p);
    }
    #[cfg(target_os = "macos")]
    return menu::set_recent(&app, paths).map_err(|e| e.to_string());
    #[cfg(not(target_os = "macos"))]
    Ok(())
}

#[tauri::command]
fn set_menu_accelerators(app: tauri::AppHandle, accels: std::collections::HashMap<String, Option<String>>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return menu::set_accelerators(&app, accels).map_err(|e| e.to_string());
    // no native menu on Windows: the page handles every shortcut itself and does not call this
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, accels);
        Ok(())
    }
}

/// Quit requests that do not come from our own menu (Dock ▸ Quit, logging out, `quit` from a script) go straight
/// to AppKit, which would end the app without a word. The window library's app delegate does not answer
/// `applicationShouldTerminate:`, so it is added here: while a project window is open the request is declined and
/// handed to the windows ("plotkit:quit", the event ⌘Q sends). Each closes itself or asks about its unsaved
/// changes, and the app exits with the last one.
#[cfg(target_os = "macos")]
mod quit_guard {
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{class, msg_send, sel};
    use std::sync::OnceLock;
    use tauri::{Emitter, Manager};

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    /// NSApplicationTerminateReply
    const CANCEL: usize = 0;
    const NOW: usize = 1;

    extern "C-unwind" fn should_terminate(_this: &AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> usize {
        let Some(app) = APP.get() else { return NOW };
        if !app.webview_windows().keys().any(|l| super::is_project_window(l)) {
            return NOW;
        }
        let _ = app.emit("plotkit:quit", ());
        CANCEL
    }

    /// Call once on the main thread, after the app has launched.
    pub fn install(app: &tauri::AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![ns_app, delegate];
            if delegate.is_null() {
                return;
            }
            let cls: *const AnyClass = msg_send![delegate, class];
            let imp: Imp = std::mem::transmute(should_terminate as extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize);
            objc2::ffi::class_addMethod(cls as *mut AnyClass, sel!(applicationShouldTerminate:), imp, c"Q@:@".as_ptr());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Windows: a double-click on a project while PlotFolio is running starts the program a second time. That
    // second start ends at once and its command line arrives here, in the running app, which opens the file and
    // comes to the front. (macOS never starts an app twice and sends RunEvent::Opened instead.) This plugin must
    // be registered before all others.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        use tauri::Manager;
        deliver_open(app, project_files_in(argv.into_iter().skip(1), std::path::Path::new(&cwd)));
        if let Some(w) = target_window(app).and_then(|l| app.get_webview_window(&l)) {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }));
    // the Mac menu bar; the Windows app draws its menus in the page
    #[cfg(target_os = "macos")]
    let builder = builder
        .manage(menu::RecentMenu(std::sync::Mutex::new(None)))
        .menu(|app| menu::build(app))
        .on_menu_event(|app, event| menu::on_event(app, event.id().0.as_str()));
    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .manage(PendingOpen(std::sync::Mutex::new(Vec::new())))
        .manage(OpenFiles(std::sync::Mutex::new(std::collections::HashMap::new())))
        .invoke_handler(tauri::generate_handler![force_quit, set_recent_files, take_pending_open, set_window_file, window_for_file, note_recent_document, set_menu_accelerators])
        .setup(|app| {
            // A project named on the command line: on Windows, the file that was double-clicked to start the app.
            // The first window exists by now but its page has not loaded, so an event would be lost: the files
            // wait in PendingOpen, which the page asks for when it is ready (take_pending_open).
            use tauri::Manager;
            let cwd = std::env::current_dir().unwrap_or_default();
            let files = project_files_in(std::env::args().skip(1), &cwd);
            for f in &files {
                allow_project_file(app.handle(), f);
            }
            app.state::<PendingOpen>().0.lock().unwrap().extend(files);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            use tauri::Manager;
            match event {
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Ready => quit_guard::install(app),
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    deliver_open(app, urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().to_string()).collect());
                }
                tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } => {
                    app.state::<OpenFiles>().0.lock().unwrap().remove(&label);
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn finds_the_project_files_on_a_command_line() {
        let cwd = Path::new("/work");
        assert_eq!(project_files_in(args(&["/data/run 1.plotproj"]), cwd), vec!["/data/run 1.plotproj"]);
        // options, other files and nothing at all
        assert!(project_files_in(args(&["--flag", "-psn_0_12345", "notes.txt"]), cwd).is_empty());
        assert!(project_files_in(args(&[]), cwd).is_empty());
        // the extension in any case; several files; a relative name is completed
        assert_eq!(project_files_in(args(&["/a/One.PLOTPROJ", "--x", "two.plotproj"]), cwd), vec!["/a/One.PLOTPROJ".to_string(), Path::new("/work").join("two.plotproj").to_string_lossy().to_string()]);
    }

    #[test]
    fn compares_windows_paths_the_way_windows_does() {
        assert_eq!(windows_path_key("D:/Lab/Run.plotproj"), windows_path_key("d:\\lab\\run.plotproj"));
        assert_eq!(windows_path_key("\\\\Server\\Share\\a.plotproj"), "\\\\server\\share\\a.plotproj");
        assert_ne!(windows_path_key("D:\\lab\\a.plotproj"), windows_path_key("D:\\lab\\b.plotproj"));
    }
}
