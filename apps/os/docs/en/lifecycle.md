---
title: Install, build, run
summary: nexo os commands: install, preview, check, build, start, stop, versions, troubleshooting.
order: 6
---

# Install, build, run

agent-os-nexo is optional in a Nexo environment. Everything here is a `nexo os` command
(`packages/cli/src/commands/os.ts`); the environment layout is in [architecture.md](architecture.md).

## Install

```bash
nexo init --os yes                              # while creating the environment, or later:
nexo os install                                 # from npm (@nexodigital/agent-os-nexo)
nexo os install --from <Agent-Os-Nexo>/apps/os  # from a checkout (until the package is published)
```

1. The package is copied into `os/source/` (without `node_modules`, `dist`, `.git`). This is the user's
   own copy from now on; install refuses to overwrite it.
2. A preflight checks this machine: a supported OS and CPU (Linux, macOS, Windows; x64, arm64) and the Node
   version in `engines`, with how to update Node on this OS when it is too old.
3. Its dependencies are installed once into `os/runtime/<hash>/`, where the hash names the dependency
   set (`dependencies` + `devDependencies`) **and the machine** (OS, CPU, Node ABI — written to `.target`): native
   modules such as node-pty only work where they were installed, so an environment used from two machines gets one
   runtime per machine. The runtime counts as ready only after npm finishes (`.ready`), so an interrupted install
   is redone, never reused.
4. `os/source/node_modules` links to that runtime, and the build is **test-started** on a free port: it is kept only
   if it answers as agent-os-nexo and every module loads; otherwise it is removed and the reason shown. The first
   build becomes `1.0.0`. `nexo doctor` warns when the active build was installed for another machine.

The desktop app's installer for this machine (AppImage, dmg or the Windows setup, built per OS by the release
workflow) comes with `nexo os desktop`, which refuses it unless its SHA-256 matches the release's checksums.

If a step fails, run `nexo os install` again: it resumes with the source already copied.

## Change, preview, build

```bash
nexo os preview            # os/source with hot reload on http://localhost:4781
nexo os stop --preview     # stop just the preview
nexo os check              # the module rules (docs/module-rules.md) — must report nothing
nexo os build --notes "what changed"
```

`build` runs `os/source/scripts/build.ts` into `os/versions/<next>.building/`: Vite builds `dist/web`, the
server code is copied (no web sources, no tests), `build.json` records version, date, notes and runtime,
and `node_modules` links to the runtime. Only a complete build is renamed to `os/versions/<next>`; a failed
one leaves nothing. Versions go patch +1, `x.y.9` → `x.(y+1).0`; the major is reserved for Nexo
releases. A source whose dependencies changed gets a new runtime; older builds keep theirs.

## Run

```bash
nexo os start [--port 4780]   # the active build, in the background; returns when it answers
nexo os status                # installed builds, the active one, what is running and its log
nexo os open [--preview]      # open it in the browser with this run's access link
nexo os stop                  # the app (add --all to stop the preview too)
nexo os use 1.0.3             # pin a build; `nexo os use latest` goes back to the newest
```

Each run has its own access link (security.md): `start` prints it and `open` opens it, so after a restart the
browser needs `nexo os open` again. The active build is the pin in `os/current`, or the newest. The running app checks for a newer build and
shows "New version detected — restart to load it" with a **Restart now** button (the Modules view has the same
button for pending module changes). It never restarts itself, and agents never restart it: only that click, from
the page that holds this run's token, does. The server hands its token to the new process on stdin (never in the
environment), so the open page just reloads; open sessions and terminals end. The new server writes its pid to the
launcher's pid file (`NEXO_PID_FILE`: `nexo os` sets `app.pid`/`preview.pid`, the desktop app `desktop.pid`) and
keeps writing to its log (`NEXO_LOG_FILE`), so `nexo os stop` and closing the desktop window still stop it.
Logs and pid files: `.state/os/app.log`, `.state/os/preview.log`, `*.pid` (`restart.log` when no launcher set one).

## Update to a new Nexo release

`os/source` is a git repository: branch `base` holds Nexo's releases exactly as shipped, `main` holds your
version (each build is a commit tagged `v<x.y.z>`).

```bash
nexo os update [--from <checkout>/apps/os]   # the new release goes on base and is merged into main
nexo os update --continue                    # after resolving conflicts (no markers left)
nexo os update --abort                       # give up: your version stays as it was
```

Your pending changes are committed first, so nothing is lost. Where you and Nexo changed the same lines the
merge stops and lists the files; resolve them by hand or ask an agent (it keeps your change and takes
Nexo's where they don't clash), then `--continue`, `nexo os check`, `nexo os preview` and `nexo os build`.
A source installed before updates existed has no history: install it again to start one.

## Desktop window

`apps/desktop` in the repository builds a Tauri app that runs the same active build in its own window
(port 47470) and stops it when closed. See its README.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `start` says it exited, with a log excerpt | Read the excerpt: a port in use (`--port`), a module that failed to build, a missing runtime (`nexo os build`). |
| `start` says another agent-os-nexo answers on the port | One is already running there (maybe from the desktop app or a preview): use it, or `--port`. |
| A module is missing from the app | the Modules view shows whether it is off, waiting for a restart, or did not load (with the error). |
| The preview shows fallback fonts | An old source without the runtime in Vite's allow list: update `vite.config.ts` from a newer release. |
| `install` cannot download the package | Not published yet: `nexo os install --from <checkout>/apps/os`. |
| Builds pile up | Each is about 20 MB (the web bundle; dependencies live in the shared runtime). Old builds can be deleted by hand, except the active one. |
