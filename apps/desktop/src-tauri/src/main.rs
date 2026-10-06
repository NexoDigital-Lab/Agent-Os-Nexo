// agent-os desktop shell: runs the Nexo environment's active agent-os build (the same one `nexo os start` runs)
// on a dedicated port, shows a splash while it boots, then points the window at it. Closing the window stops
// that server. An agent-os already answering on the port is reused, not duplicated.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, Url};

/// Off `nexo os start` (4780) and the preview (4781), so all three can run side by side. The capabilities in
/// capabilities/*.json are scoped to this origin: change both together.
const DEFAULT_PORT: u16 = 47470;
const BOOT_TIMEOUT: Duration = Duration::from_secs(90);

struct Server(Mutex<Option<Child>>);

fn port_from_env() -> u16 {
    env::var("NEXO_APP_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(DEFAULT_PORT)
}

fn home() -> PathBuf {
    env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_default()
}

/// The environment: $NEXO_ROOT, else the default `nexo init` location (~/environments).
fn env_root() -> PathBuf {
    env::var_os("NEXO_ROOT").map(PathBuf::from).unwrap_or_else(|| home().join("environments"))
}

/// The os/ and .state/ folders, honoring renamed folders in environment.config.json.
fn env_folders(root: &Path) -> Result<(PathBuf, PathBuf), String> {
    let config = root.join("environment.config.json");
    let text = fs::read_to_string(&config)
        .map_err(|_| format!("No Nexo environment at {}. Set NEXO_ROOT or run `nexo init`.", root.display()))?;
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", config.display()))?;
    let folder = |key: &str, default: &str| root.join(json["folders"][key].as_str().unwrap_or(default));
    Ok((folder("os", "os"), folder("state", ".state")))
}

fn semver(v: &str) -> Option<(u64, u64, u64)> {
    let mut parts = v.split('.').map(|p| p.parse::<u64>().ok());
    match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(Some(a)), Some(Some(b)), Some(Some(c)), None) => Some((a, b, c)),
        _ => None,
    }
}

/// The build to run: the pin in os/current, else the newest in os/versions (same rule as the CLI).
fn active_build(os_dir: &Path) -> Result<PathBuf, String> {
    let pinned = fs::read_to_string(os_dir.join("current")).map(|s| s.trim().to_string()).unwrap_or_default();
    let version = if !pinned.is_empty() {
        pinned
    } else {
        fs::read_dir(os_dir.join("versions"))
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter_map(|name| semver(&name).map(|v| (v, name)))
            .max()
            .map(|(_, name)| name)
            .ok_or("agent-os has no builds yet. Run `nexo os install`.")?
    };
    let dir = os_dir.join("versions").join(&version);
    if dir.join("host/server/main.ts").is_file() {
        Ok(dir)
    } else {
        Err(format!("The build {version} is missing or incomplete. Run `nexo os use latest` or `nexo os build`."))
    }
}

/// Desktop launchers don't source the shell profile, so add the usual user bin dirs (node, claude) by hand.
fn child_path() -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let home = home();
    let mut dirs: Vec<String> = [".local/bin", ".npm-global/bin", ".cargo/bin", ".volta/bin"]
        .iter()
        .map(|d| home.join(d).display().to_string())
        .collect();
    dirs.extend(env::var("PATH").unwrap_or_default().split(sep).map(String::from));
    if cfg!(unix) {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].map(String::from));
    }
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| !d.is_empty() && seen.insert(d.clone()));
    dirs.join(sep)
}

fn find_node(path: &str) -> Option<PathBuf> {
    if let Ok(node) = env::var("NEXO_NODE") {
        return Some(PathBuf::from(node));
    }
    let sep = if cfg!(windows) { ';' } else { ':' };
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    path.split(sep).map(|d| Path::new(d).join(exe)).find(|p| p.is_file())
}

fn is_listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// True only if what answers on the port is agent-os: `GET /api/os/info` → 200 stamped `X-Agent-OS: 1`
/// (host/server/http.ts). A bare "port is open" would happily load some other program's page into the window.
fn is_agent_os(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    let req = format!("GET /api/os/info HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\n\r\n");
    if s.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    let _ = s.take(8192).read_to_end(&mut buf); // a read timeout still leaves the bytes read so far
    let text = String::from_utf8_lossy(&buf);
    let status_ok = text.lines().next().is_some_and(|l| l.split_whitespace().nth(1) == Some("200"));
    let head = text.split_once("\r\n\r\n").map_or(&*text, |(h, _)| h);
    status_ok && head.lines().any(|l| l.to_ascii_lowercase().replace(' ', "") == "x-agent-os:1")
}

/// Windows process creation flag: start the child without a console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Must be called from the main thread on Linux: PR_SET_PDEATHSIG fires when the *thread* that spawned the
/// child exits, not the process, so spawning from a short-lived worker would kill the server early.
fn spawn_server(root: &Path, build: &Path, log_path: &Path, port: u16) -> Result<Child, String> {
    let path = child_path();
    let node = find_node(&path).ok_or("Could not find `node` (set NEXO_NODE to its path).")?;
    if let Some(dir) = log_path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let _ = fs::rename(log_path, log_path.with_extension("log.1")); // keep the previous run's log for debugging
    let log = File::create(log_path).map_err(|e| e.to_string())?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(node);
    cmd.arg(build.join("host/server/main.ts"))
        .args(["--port", &port.to_string()])
        .current_dir(build)
        .env("PATH", path)
        .env("NEXO_ROOT", root)
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(log_err);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own process group, so shutdown also reaches whatever the server spawned (agents, language servers).
        cmd.process_group(0);
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        // Backstop if this process dies without running cleanup (e.g. SIGKILL): the kernel signals the server.
        unsafe {
            cmd.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // The server runs headless: no console window pops up next to the app.
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map_err(|e| format!("Could not start the agent-os server: {e}"))
}

fn stop_server(child: &mut Child) {
    #[cfg(unix)]
    {
        let pgid = child.id() as i32;
        unsafe { libc::kill(-pgid, libc::SIGTERM) };
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        // Always SIGKILL the group, even if the leader exited: grandchildren may linger. ESRCH is fine.
        unsafe { libc::kill(-pgid, libc::SIGKILL) };
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No process groups on Windows: end the server's whole tree (agents, language servers), then the server.
        let _ = Command::new("taskkill")
            .args(["/pid", &child.id().to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        let _ = child.kill();
    }
    let _ = child.wait();
}

/// The splash DOM may not exist yet (setup runs before the page loads), so the idempotent,
/// null-safe script is retried for a couple of seconds from a thread.
fn show_error(app: &tauri::AppHandle, msg: &str) {
    let msg = serde_json::to_string(msg).unwrap_or_else(|_| "\"error\"".into());
    let js = format!(
        "{{const e=document.getElementById('err'); if(e){{e.textContent={msg}}} \
         const d=document.getElementById('dots'); if(d){{d.style.display='none'}}}}"
    );
    let app = app.clone();
    thread::spawn(move || {
        for _ in 0..10 {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.eval(&js);
            }
            thread::sleep(Duration::from_millis(250));
        }
    });
}

/// Page zoom for the web UI (Ctrl +/−/0, the rail control; modules/shell/web/zoom.ts). On Linux, WebKitGTK applies
/// a new zoom level but doesn't always recompute the viewport, so the layout could stay sized for the previous level
/// (content cut off at the bottom): re-allocating the widget (1 px smaller, then back) makes it lay the page out again.
#[tauri::command]
fn set_page_zoom(webview: tauri::Webview, level: f64) -> Result<(), String> {
    if !level.is_finite() {
        return Err("Invalid zoom".into());
    }
    let level = level.clamp(0.5, 2.0);
    #[cfg(target_os = "linux")]
    {
        webview
            .with_webview(move |pw| {
                use gtk::prelude::WidgetExt;
                use webkit2gtk::WebViewExt;
                let wv = pw.inner();
                wv.set_zoom_level(level);
                let nudge = |wv: &webkit2gtk::WebView| {
                    let a = wv.allocation();
                    wv.size_allocate(&gtk::Rectangle::new(a.x(), a.y(), a.width(), (a.height() - 1).max(1)));
                    wv.size_allocate(&a);
                };
                nudge(&wv);
                // The zoom reaches the web process asynchronously: nudge again once it has surely applied.
                gtk::glib::timeout_add_local_once(Duration::from_millis(60), move || nudge(&wv));
            })
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        webview.set_zoom(level).map_err(|e| e.to_string())
    }
}

/// Logout / kill / Ctrl-C go through the normal exit path, so the server gets stopped.
#[cfg(unix)]
fn exit_on_signals(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};
    let mut signals = signal_hook::iterator::Signals::new([SIGTERM, SIGINT, SIGHUP])?;
    let app = app.clone();
    thread::spawn(move || {
        if signals.forever().next().is_some() {
            app.exit(0);
        }
    });
    Ok(())
}

fn main() {
    let port = port_from_env();
    let root = env_root();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(Server(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![set_page_zoom])
        .setup(move |app| {
            let handle = app.handle().clone();
            #[cfg(unix)]
            exit_on_signals(&handle)?;

            let (os_dir, state_dir) = match env_folders(&root) {
                Ok(f) => f,
                Err(e) => {
                    show_error(&handle, &e);
                    return Ok(());
                }
            };
            let log_path = state_dir.join("os").join("desktop.log");
            // The server writes this run's access token here at startup (apps/os/host/server/access.ts).
            let token_file = state_dir.join("os").join(format!("token-{port}"));
            let log_hint = log_path.display().to_string();

            if is_listening(port) {
                if !is_agent_os(port) {
                    show_error(&handle, &format!("Port {port} is used by another program. Close it or set NEXO_APP_PORT."));
                    return Ok(());
                }
            } else {
                match active_build(&os_dir).and_then(|build| spawn_server(&root, &build, &log_path, port)) {
                    Ok(child) => *app.state::<Server>().0.lock().unwrap() = Some(child),
                    Err(e) => {
                        show_error(&handle, &e);
                        return Ok(());
                    }
                }
            }

            thread::spawn(move || {
                let started = Instant::now();
                let mut warned = false;
                loop {
                    if is_listening(port) && is_agent_os(port) {
                        let token = fs::read_to_string(&token_file).map(|t| t.trim().to_string()).unwrap_or_default();
                        let query = if token.is_empty() { String::new() } else { format!("/?token={token}") };
                        let url = Url::parse(&format!("http://127.0.0.1:{port}{query}")).unwrap();
                        if let Some(win) = handle.get_webview_window("main") {
                            let _ = win.navigate(url);
                        }
                        return;
                    }
                    let exited = handle
                        .state::<Server>()
                        .0
                        .lock()
                        .unwrap()
                        .as_mut()
                        .is_some_and(|c| matches!(c.try_wait(), Ok(Some(_))));
                    let msg = format!("agent-os did not start. See the log:\n{log_hint}");
                    if exited {
                        show_error(&handle, &msg);
                        return;
                    }
                    // Past the timeout, warn once but keep polling (slower): a slow first boot may still come up.
                    if started.elapsed() > BOOT_TIMEOUT {
                        if !warned {
                            warned = true;
                            show_error(&handle, &msg);
                        }
                        thread::sleep(Duration::from_secs(1));
                    } else {
                        thread::sleep(Duration::from_millis(250));
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building agent-os")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() {
                    stop_server(&mut child);
                }
            }
        });
}
