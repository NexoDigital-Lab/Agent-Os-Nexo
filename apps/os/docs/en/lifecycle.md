---
title: Install, build, run
summary: nexo os commands: install, preview, check, build, start, stop, versions, troubleshooting.
order: 6
---

# Install, build, run

agent-os is optional in a Nexo environment. Everything here is a `nexo os` command
(`packages/cli/src/commands/os.ts`); the environment layout is in [architecture.md](architecture.md).

## Install

```bash
nexo init --os yes                              # while creating the environment, or later:
nexo os install                                 # from npm (@nexodigital-lab/agent-os)
nexo os install --from <Agent-Os-Nexo>/apps/os  # from a checkout (until the package is published)
```

1. The package is copied into `os/source/` (without `node_modules`, `dist`, `.git`). This is the user's
   own copy from now on; install refuses to overwrite it.
2. Its dependencies are installed once into `os/runtime/<hash>/`, where the hash names the dependency
   set (`dependencies` + `devDependencies`). The runtime counts as ready only after npm finishes
   (`.ready`), so an interrupted install is redone, never reused.
3. `os/source/node_modules` links to that runtime, and the first build becomes `1.0.0`.

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
shows "New version detected — restart to load it"; it never restarts itself, and agents never restart it.
Logs and pid files: `.state/os/app.log`, `.state/os/preview.log`, `*.pid`.

## Desktop window

`apps/desktop` in the repository builds a Tauri app that runs the same active build in its own window
(port 47470) and stops it when closed. See its README.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `start` says it exited, with a log excerpt | Read the excerpt: a port in use (`--port`), a module that failed to build, a missing runtime (`nexo os build`). |
| `start` says another agent-os answers on the port | One is already running there (maybe from the desktop app or a preview): use it, or `--port`. |
| A module is missing from the app | Settings → Modules shows whether it is off, waiting for a restart, or did not load (with the error). |
| The preview shows fallback fonts | An old source without the runtime in Vite's allow list: update `vite.config.ts` from a newer release. |
| `install` cannot download the package | Not published yet: `nexo os install --from <checkout>/apps/os`. |
| Builds pile up | Each is about 20 MB (the web bundle; dependencies live in the shared runtime). Old builds can be deleted by hand, except the active one. |
