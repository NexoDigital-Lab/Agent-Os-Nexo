// agent-os-nexo desktop shell: runs the Nexo environment's active agent-os-nexo build (the same one `nexo os start` runs)
// on a dedicated port, shows a splash while it boots, then points the window at it. Closing the window stops
// that server. An agent-os-nexo already answering on the port is reused, not duplicated.
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
/// The oldest Node.js agent-os-nexo runs on (root package.json `engines`): it runs TypeScript natively.
const MIN_NODE: (u64, u64, u64) = (22, 18, 0);
/// Node 23 only strips types without a flag from 23.6 on (22.18 got it as a backport).
const MIN_NODE_23: (u64, u64, u64) = (23, 6, 0);
/// How long `node --version` may take before that binary is reported as not responding.
const NODE_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
/// Lines of the server log shown under "Technical details" when the server exits during boot.
const LOG_TAIL_LINES: usize = 20;
/// Settings the splash tells users to change; "Try again" re-reads them (retry_start).
#[cfg_attr(not(windows), allow(dead_code))]
const SETTING_VARS: [&str; 3] = ["NEXO_NODE", "NEXO_ROOT", "NEXO_APP_PORT"];

struct Server(Mutex<Option<Child>>);

/// Why the window could not show agent-os-nexo. The splash (splash/index.html) turns `code` + `params` into a
/// translated title, explanation and steps to fix it, so the wording lives in one place and Rust only says what
/// happened.
#[derive(Debug, PartialEq)]
enum StartError {
    NoEnvironment { root: String },
    BadConfig { file: String, detail: String },
    NoBuilds,
    BrokenBuild { version: String },
    NodeMissing,
    NodeInvalid { path: String },
    NodeTooOld { version: String, path: String },
    NodeNotResponding { path: String },
    PortTaken { port: u16 },
    LogUnwritable { path: String, detail: String },
    SpawnFailed { detail: String },
    ServerExited { log: String, tail: String },
    SlowStart { log: String },
}

impl StartError {
    fn to_json(&self) -> serde_json::Value {
        use serde_json::json;
        let version = |(a, b, c): (u64, u64, u64)| format!("{a}.{b}.{c}");
        let (min, min23) = (version(MIN_NODE), version(MIN_NODE_23));
        match self {
            Self::NoEnvironment { root } => json!({ "code": "no-environment", "params": { "root": root } }),
            Self::BadConfig { file, detail } => {
                json!({ "code": "bad-config", "params": { "file": file }, "detail": detail })
            }
            Self::NoBuilds => json!({ "code": "no-builds", "params": {} }),
            Self::BrokenBuild { version } => json!({ "code": "broken-build", "params": { "version": version } }),
            Self::NodeMissing => json!({ "code": "node-missing", "params": { "min": min } }),
            Self::NodeInvalid { path } => json!({ "code": "node-invalid", "params": { "path": path } }),
            Self::NodeTooOld { version, path } => {
                let params = json!({ "version": version, "path": path, "min": min, "min23": min23 });
                json!({ "code": "node-too-old", "params": params })
            }
            Self::NodeNotResponding { path } => json!({ "code": "node-unresponsive", "params": { "path": path } }),
            Self::PortTaken { port } => json!({ "code": "port-taken", "params": { "port": port } }),
            Self::LogUnwritable { path, detail } => {
                json!({ "code": "log-unwritable", "params": { "path": path }, "detail": detail })
            }
            Self::SpawnFailed { detail } => json!({ "code": "spawn-failed", "params": {}, "detail": detail }),
            Self::ServerExited { log, tail } => {
                json!({ "code": "server-exited", "params": { "log": log }, "detail": tail, "hasLog": true })
            }
            Self::SlowStart { log } => {
                json!({ "code": "slow-start", "params": { "log": log }, "hasLog": true, "waiting": true })
            }
        }
    }
}

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
fn env_folders(root: &Path) -> Result<(PathBuf, PathBuf), StartError> {
    let config = root.join("environment.config.json");
    let text =
        fs::read_to_string(&config).map_err(|_| StartError::NoEnvironment { root: root.display().to_string() })?;
    let json: serde_json::Value = serde_json::from_str(&text).map_err(|e| StartError::BadConfig {
        file: config.display().to_string(),
        detail: e.to_string(),
    })?;
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
fn active_build(os_dir: &Path) -> Result<PathBuf, StartError> {
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
            .ok_or(StartError::NoBuilds)?
    };
    let dir = os_dir.join("versions").join(&version);
    if dir.join("host/server/main.ts").is_file() {
        Ok(dir)
    } else {
        Err(StartError::BrokenBuild { version })
    }
}

const PATH_SEP: char = if cfg!(windows) { ';' } else { ':' };

/// Expands `%NAME%` references (Windows REG_EXPAND_SZ values) with `lookup`; unknown names are left as they are.
fn expand_percent_vars(value: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => {
                let name = &after[..end];
                out.push_str(&lookup(name).unwrap_or_else(|| format!("%{name}%")));
                rest = &after[end + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Windows hands a process the environment of whoever launched it, frozen at that moment: install Node.js or set a
/// variable, open the app from a window that was already running, and the change is not there. The registry holds
/// the environment as it is now.
#[cfg(windows)]
mod registry {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    const MACHINE: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";

    /// A variable's raw value (`%VARS%` unexpanded) from the user's environment, then the machine's. Read through
    /// the registry API, so paths with non-ASCII characters (C:\Users\José) arrive intact.
    fn read(scope: winreg::HKEY, key: &str, name: &str) -> Option<String> {
        RegKey::predef(scope).open_subkey(key).ok()?.get_value::<String, _>(name).ok().filter(|v| !v.is_empty())
    }

    pub fn var(name: &str) -> Option<String> {
        read(HKEY_CURRENT_USER, "Environment", name).or_else(|| read(HKEY_LOCAL_MACHINE, MACHINE, name))
    }

    /// Both PATH values: Windows joins the machine's and the user's.
    pub fn path_values() -> Vec<String> {
        [read(HKEY_CURRENT_USER, "Environment", "Path"), read(HKEY_LOCAL_MACHINE, MACHINE, "Path")]
            .into_iter()
            .flatten()
            .collect()
    }
}

#[cfg(windows)]
fn registry_path_dirs() -> Vec<String> {
    registry::path_values()
        .iter()
        .flat_map(|value| {
            expand_percent_vars(value, |name| env::var(name).ok())
                .split(PATH_SEP)
                .map(String::from)
                .collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(not(windows))]
fn registry_path_dirs() -> Vec<String> {
    Vec::new()
}

/// Before "Try again" relaunches the app (which inherits this process's environment), take the settings the
/// splash asked the user to change from the registry: set, changed or removed since the app started.
fn refresh_setting_vars() {
    #[cfg(windows)]
    for name in SETTING_VARS {
        match registry::var(name) {
            Some(value) => env::set_var(name, value),
            None => env::remove_var(name),
        }
    }
}

/// Where the usual Node.js installers put `node` when it is not on PATH (yet).
fn node_install_dirs() -> Vec<String> {
    let var = |name: &str| env::var(name).ok().filter(|v| !v.is_empty());
    let mut dirs = Vec::new();
    if cfg!(windows) {
        if let Some(p) = var("ProgramFiles") {
            dirs.push(format!(r"{p}\nodejs"));
        }
        if let Some(p) = var("LOCALAPPDATA") {
            dirs.push(format!(r"{p}\Programs\nodejs"));
        }
        if let Some(p) = var("NVM_SYMLINK") {
            dirs.push(p);
        }
        if let Some(p) = var("APPDATA") {
            dirs.push(format!(r"{p}\npm")); // global npm bins (claude, codex…)
        }
        dirs.push(home().join(r"scoop\shims").display().to_string());
    } else {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].map(String::from));
    }
    dirs
}

/// Desktop launchers don't source the shell profile, so add the usual user bin dirs (node, claude) by hand.
fn child_path() -> String {
    let home = home();
    let mut dirs: Vec<String> = [".local/bin", ".npm-global/bin", ".cargo/bin", ".volta/bin"]
        .iter()
        .map(|d| home.join(d).display().to_string())
        .collect();
    dirs.extend(env::var("PATH").unwrap_or_default().split(PATH_SEP).map(String::from));
    dirs.extend(registry_path_dirs());
    dirs.extend(node_install_dirs());
    let mut seen = std::collections::HashSet::new();
    // Windows paths are case-insensitive: the registry and the inherited PATH often spell the same dir differently.
    dirs.retain(|d| !d.is_empty() && seen.insert(if cfg!(windows) { d.to_lowercase() } else { d.clone() }));
    dirs.join(&PATH_SEP.to_string())
}

/// `node`: $NEXO_NODE (a path, or a bare command looked up in `path`), else the first one on `path`.
fn find_node(path: &str) -> Result<PathBuf, StartError> {
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    let on_path = |name: &str| path.split(PATH_SEP).map(|d| Path::new(d).join(name)).find(|p| p.is_file());
    if let Some(node) = env::var_os("NEXO_NODE").filter(|v| !v.is_empty()) {
        let node = PathBuf::from(node);
        if node.is_file() {
            return Ok(node);
        }
        let bare = node.components().count() == 1;
        let name = node.display().to_string();
        let found = bare.then(|| on_path(&name).or_else(|| on_path(&format!("{name}.exe")))).flatten();
        return found.ok_or(StartError::NodeInvalid { path: name });
    }
    on_path(exe).ok_or(StartError::NodeMissing)
}

/// `v24.20.0` → (24, 20, 0).
fn parse_node_version(text: &str) -> Option<(u64, u64, u64)> {
    semver(text.trim().trim_start_matches('v'))
}

fn node_supported(v: (u64, u64, u64)) -> bool {
    v >= MIN_NODE && (v.0 != 23 || v >= MIN_NODE_23)
}

/// Asks `node --version`, bounded by NODE_PROBE_TIMEOUT so a binary that never exits can't freeze startup. Fails
/// when the version is too old or the binary doesn't answer; a binary that answers something else is left to fail
/// on its own, with its output in the log.
fn check_node_version(node: &Path) -> Result<(), StartError> {
    let path = node.display().to_string();
    let mut cmd = Command::new(node);
    cmd.arg("--version").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let Ok(mut child) = cmd.spawn() else { return Ok(()) }; // spawn_server reports it with the real error
    let deadline = Instant::now() + NODE_PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(StartError::NodeNotResponding { path });
            }
        }
    }
    let mut text = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut text);
    }
    let text = text.trim().to_string();
    match parse_node_version(&text) {
        Some(v) if !node_supported(v) => Err(StartError::NodeTooOld { version: text, path }),
        _ => Ok(()),
    }
}

/// The last `n` lines of the server log, for the error's technical details.
fn tail_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

fn is_listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// True only if what answers on the port is agent-os-nexo: `GET /api/os/info` → 200 stamped `X-Agent-OS-Nexo: 1`
/// (host/server/http.ts), or `X-Agent-OS: 1` from a build made before the rename. A bare "port is open" would
/// happily load some other program's page into the window.
fn is_agent_os_nexo(port: u16) -> bool {
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
    status_ok
        && head.lines().any(|l| {
            let l = l.to_ascii_lowercase().replace(' ', "");
            l == "x-agent-os-nexo:1" || l == "x-agent-os:1"
        })
}

/// Windows process creation flag: start the child without a console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Must be called from the main thread on Linux: PR_SET_PDEATHSIG fires when the *thread* that spawned the
/// child exits, not the process, so spawning from a short-lived worker would kill the server early.
fn spawn_server(root: &Path, build: &Path, log_path: &Path, port: u16) -> Result<Child, StartError> {
    let path = child_path();
    let node = find_node(&path)?;
    check_node_version(&node)?;
    let io = |e: std::io::Error| StartError::LogUnwritable { path: log_path.display().to_string(), detail: e.to_string() };
    if let Some(dir) = log_path.parent() {
        fs::create_dir_all(dir).map_err(io)?;
    }
    let _ = fs::rename(log_path, log_path.with_extension("log.1")); // keep the previous run's log for debugging
    let pid_file = restarted_pid_file(log_path);
    let _ = fs::remove_file(&pid_file); // a previous run's; this one has not restarted yet
    let _ = RESTART_PID_FILE.set(pid_file.clone());
    let log = File::create(log_path).map_err(io)?;
    let log_err = log.try_clone().map_err(io)?;
    let mut cmd = Command::new(&node);
    cmd.arg(build.join("host/server/main.ts"))
        .args(["--port", &port.to_string()])
        .current_dir(build)
        .env("PATH", path)
        .env("NEXO_ROOT", root)
        // "Restart now" in the page: the server relaunches itself and writes the new pid here, so closing the
        // window still stops it (stop_restarted), and its output keeps going to this log.
        .env("NEXO_PID_FILE", &pid_file)
        .env("NEXO_LOG_FILE", log_path)
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
    let child = cmd.spawn().map_err(|e| StartError::SpawnFailed { detail: format!("{}: {e}", node.display()) })?;
    #[cfg(windows)]
    job::adopt(&child);
    Ok(child)
}

/// Windows has no process groups or parent-death signal: if this app crashes or is ended from Task Manager, the
/// server and everything it started (agents, a restarted server) would keep running. A job object that kills its
/// processes when its last handle closes (when this process ends, however it ends) ties them to the app.
#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::sync::OnceLock;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// The job's handle, opened once and never closed: the OS closes it when this process exits.
    static JOB: OnceLock<usize> = OnceLock::new();

    fn create() -> usize {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return 0;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                return 0;
            }
            job as usize
        }
    }

    /// Best effort: without the job the server still stops on a normal close (stop_server).
    pub fn adopt(child: &Child) {
        let job = *JOB.get_or_init(create);
        if job != 0 {
            unsafe { AssignProcessToJobObject(job as _, child.as_raw_handle() as _) };
        }
    }
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

/// Where a server restarted from its own page records its pid (next to the desktop log).
fn restarted_pid_file(log_path: &Path) -> PathBuf {
    log_path.with_file_name("desktop.pid")
}

static RESTART_PID_FILE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Stops the server that replaced ours after a restart, if any: it is not our child, so it is found by its pid file.
fn stop_restarted(original: Option<u32>) {
    let Some(file) = RESTART_PID_FILE.get() else { return };
    let pid = fs::read_to_string(file).ok().and_then(|t| t.trim().parse::<u32>().ok());
    let _ = fs::remove_file(file);
    let Some(pid) = pid.filter(|p| Some(*p) != original && *p > 1) else { return };
    #[cfg(unix)]
    {
        // The restarted server leads its own process group (spawned detached): end it with what it started.
        let pgid = pid as i32;
        unsafe { libc::kill(-pgid, libc::SIGTERM) };
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline && unsafe { libc::kill(pgid, 0) } == 0 {
            thread::sleep(Duration::from_millis(100));
        }
        unsafe { libc::kill(-pgid, libc::SIGKILL) };
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/pid", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

/// Hands the error to the splash's `nexoError` (splash/index.html), which renders it. The splash may not have loaded
/// yet (setup runs first, and a cold WebView2 can take seconds), so the idempotent, null-safe call is retried for
/// ten seconds from a thread.
fn show_error(app: &tauri::AppHandle, err: &StartError) {
    let js = format!("window.nexoError && window.nexoError({})", err.to_json());
    let app = app.clone();
    thread::spawn(move || {
        for _ in 0..40 {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.eval(&js);
            }
            thread::sleep(Duration::from_millis(250));
        }
    });
}

static LOG_PATH: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// "Try again" on the splash: stop whatever this run started, then relaunch the app so startup runs from scratch
/// (and picks up a Node.js installed, or an environment variable set, since). Async, so stopping the server (up to
/// a few seconds) runs off the main thread and the window stays responsive.
#[tauri::command]
async fn retry_start(app: tauri::AppHandle) {
    let child = app.state::<Server>().0.lock().unwrap().take();
    let original = child.as_ref().map(|c| c.id());
    if let Some(mut child) = child {
        stop_server(&mut child);
    }
    stop_restarted(original);
    refresh_setting_vars();
    app.restart();
}

/// "Open log" on the splash: the server log in the system's default viewer. Takes no path from the page.
#[tauri::command]
fn open_log() -> Result<(), String> {
    let log = LOG_PATH.get().filter(|p| p.is_file()).ok_or("The log does not exist yet.")?;
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("explorer");
        c.arg(log);
        c
    } else {
        let mut c = Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" });
        c.arg(log);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
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
    // WebKitGTK's DMA-BUF renderer leaves the window blank or invisible on many Linux setups (Wayland, some GPU
    // drivers). Off unless the user set the variable themselves; set before any thread starts.
    #[cfg(target_os = "linux")]
    if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    let port = port_from_env();
    let root = env_root();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(Server(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![set_page_zoom, retry_start, open_log])
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
            let _ = LOG_PATH.set(log_path.clone());
            // The server writes this run's access token here at startup (apps/os/host/server/access.ts).
            let token_file = state_dir.join("os").join(format!("token-{port}"));
            let log_hint = log_path.display().to_string();

            if is_listening(port) {
                if !is_agent_os_nexo(port) {
                    show_error(&handle, &StartError::PortTaken { port });
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
                    if is_listening(port) && is_agent_os_nexo(port) {
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
                    if exited {
                        let log = fs::read_to_string(&log_path).unwrap_or_default();
                        let tail = tail_lines(&log, LOG_TAIL_LINES);
                        show_error(&handle, &StartError::ServerExited { log: log_hint, tail });
                        return;
                    }
                    // Past the timeout, warn once but keep polling (slower): a slow first boot may still come up.
                    if started.elapsed() > BOOT_TIMEOUT {
                        if !warned {
                            warned = true;
                            show_error(&handle, &StartError::SlowStart { log: log_hint.clone() });
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
        .expect("error building agent-os-nexo")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                let child = app.state::<Server>().0.lock().unwrap().take();
                let original = child.as_ref().map(|c| c.id());
                if let Some(mut child) = child {
                    stop_server(&mut child);
                }
                stop_restarted(original);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_known_percent_vars_and_keeps_the_rest() {
        let lookup = |name: &str| (name == "ProgramFiles").then(|| r"C:\Program Files".to_string());
        assert_eq!(expand_percent_vars(r"%ProgramFiles%\nodejs", lookup), r"C:\Program Files\nodejs");
        assert_eq!(expand_percent_vars(r"%Missing%\bin", lookup), r"%Missing%\bin");
        assert_eq!(expand_percent_vars("100% sure", lookup), "100% sure");
        assert_eq!(expand_percent_vars("a%%b", lookup), "a%%b");
    }

    #[test]
    fn parses_node_versions() {
        assert_eq!(parse_node_version("v24.20.0\n"), Some((24, 20, 0)));
        assert_eq!(parse_node_version("v22.18.0"), Some((22, 18, 0)));
        assert_eq!(parse_node_version("not node"), None);
        assert!(parse_node_version("v22.17.1").unwrap() < MIN_NODE);
        assert!(parse_node_version("v22.18.0").unwrap() >= MIN_NODE);
    }

    #[test]
    fn supports_22_18_up_except_23_before_type_stripping() {
        assert!(!node_supported((20, 11, 0)));
        assert!(!node_supported((22, 17, 1)));
        assert!(node_supported((22, 18, 0)));
        assert!(!node_supported((23, 0, 0)));
        assert!(!node_supported((23, 5, 9)));
        assert!(node_supported((23, 6, 0)));
        assert!(node_supported((24, 0, 0)));
    }

    #[cfg(windows)]
    #[test]
    fn reads_the_user_environment_from_the_registry() {
        // Every Windows account has a TEMP in HKCU\Environment, stored unexpanded (%USERPROFILE%\AppData\…).
        assert!(registry::var("TEMP").is_some_and(|v| !v.is_empty()));
        assert!(registry::var("NEXO_SURELY_NOT_SET_9c1f").is_none());
        assert!(!registry::path_values().is_empty());
    }

    #[test]
    fn tails_the_last_non_blank_lines() {
        assert_eq!(tail_lines("a\n\nb\nc\n", 2), "b\nc");
        assert_eq!(tail_lines("only", 5), "only");
        assert_eq!(tail_lines("", 5), "");
    }

    #[test]
    fn errors_carry_a_code_the_splash_knows() {
        let codes = [
            StartError::NoEnvironment { root: "r".into() }.to_json(),
            StartError::BadConfig { file: "f".into(), detail: "d".into() }.to_json(),
            StartError::NoBuilds.to_json(),
            StartError::BrokenBuild { version: "1.0.0".into() }.to_json(),
            StartError::NodeMissing.to_json(),
            StartError::NodeInvalid { path: "p".into() }.to_json(),
            StartError::NodeTooOld { version: "v20.0.0".into(), path: "p".into() }.to_json(),
            StartError::NodeNotResponding { path: "p".into() }.to_json(),
            StartError::PortTaken { port: 1 }.to_json(),
            StartError::LogUnwritable { path: "p".into(), detail: "d".into() }.to_json(),
            StartError::SpawnFailed { detail: "d".into() }.to_json(),
            StartError::ServerExited { log: "l".into(), tail: "t".into() }.to_json(),
            StartError::SlowStart { log: "l".into() }.to_json(),
        ];
        // Each code needs a message in every language, and every {param} a message uses must be one Rust sends.
        let splash = include_str!("../../splash/index.html");
        let (en, es) = splash.split_once("\n      es: {").expect("splash/index.html has an `es` table");
        let en = &en[en.find("\n      en: {").expect("splash/index.html has an `en` table")..];
        let es = &es[..es.find("\n    };").expect("end of the message tables")];
        for json in codes {
            let code = json["code"].as_str().unwrap();
            for (lang, table) in [("en", en), ("es", es)] {
                let key = format!("\"{code}\":");
                let start = table.find(&key).unwrap_or_else(|| panic!("no {lang} message for {code}"));
                let block = &table[start..];
                let block = &block[..block.find("] },").map_or(block.len(), |i| i + 4)];
                for param in block.split('{').skip(1).filter_map(|p| p.split_once('}')).map(|(name, _)| name) {
                    if param.chars().all(|c| c.is_ascii_alphanumeric()) && !param.is_empty() {
                        assert!(json["params"].get(param).is_some(), "{lang} {code} uses {{{param}}}, Rust sends no such param");
                    }
                }
            }
        }
        assert_eq!(StartError::NodeMissing.to_json()["params"]["min"], "22.18.0");
    }
}
