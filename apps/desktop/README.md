# agent-os-nexo desktop

agent-os-nexo in its own window: a [Tauri 2](https://tauri.app) shell that runs the Nexo environment's
**active agent-os-nexo build** (the same one `nexo os start` runs) on `127.0.0.1:47470`, shows a splash
while it boots, then loads it. Closing the window stops that server and everything it started. If an
agent-os-nexo already answers on the port, the window reuses it instead of starting another one.

Optional: agent-os-nexo works the same in a browser (`nexo os start`). Not an npm workspace, so a plain
`npm install` at the repository root never downloads the Tauri tooling.

## Build

Needs Rust (stable) and the Tauri system dependencies of your OS
(<https://tauri.app/start/prerequisites/>). On Fedora: `webkit2gtk4.1-devel`, `gtk3-devel`,
`libappindicator-gtk3-devel`, `librsvg2-devel`.

```bash
cd apps/desktop
npm install
npm run build:binary   # just the binary: src-tauri/target/release/agent-os-nexo-desktop
npm run build          # binary + installers (deb, rpm, AppImage on Linux; dmg on macOS; nsis on Windows)
npm run dev            # debug build, runs it
```

## Runtime

| Variable | Default | What it sets |
|---|---|---|
| `NEXO_ROOT` | `~/environments` | The environment whose `os/versions/` is run |
| `NEXO_APP_PORT` | `47470` | The port; the capabilities in `src-tauri/capabilities/` are scoped to 47470, so change both |
| `NEXO_NODE` | `node` on `PATH` | The Node.js binary, 22.18+ (23.6+ on the 23 line). Desktop launchers don't load the shell profile, so `~/.local/bin`, `~/.npm-global/bin`, `~/.volta/bin` and Homebrew are added; on Windows also the PATH as the registry holds it now (a Node.js installed after the launcher started is found) and the usual install folders |

When startup fails, the splash says what happened and how to fix it (in English or Spanish, after the system
language), with the technical detail, **Try again**, **Open log** and **Copy details**. The messages live in
`splash/index.html`, keyed by the codes of `StartError` in `src-tauri/src/main.rs`; `cargo test` checks that every
code has a message in each language. On Windows, **Try again** re-reads `NEXO_NODE`, `NEXO_ROOT` and
`NEXO_APP_PORT` from the registry, so a variable set after the app started counts. Also on Windows, the server runs
in a job object: if the app crashes or is ended from Task Manager, the server and what it started end with it.

The server log goes to `.state/os/desktop.log` in the environment (the previous run's is kept as
`desktop.log.1`). The window only loads the port if it answers `GET /api/os/info` with
`X-Agent-OS-Nexo: 1`, so another program on the port is never shown, and it enters with the run's access token
(`.state/os/token-<port>`).

The web UI talks to the shell through two permissions: native notifications (a tab finished or needs
you) and `set_page_zoom` (Ctrl +/−/0; on Linux it also makes WebKitGTK re-lay out the page).
