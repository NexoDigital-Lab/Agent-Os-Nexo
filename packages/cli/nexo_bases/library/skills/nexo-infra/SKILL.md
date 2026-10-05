---
name: nexo-infra
description: Know how a project runs locally and how to validate a production build, written down once in context/infra.md — discover it from the repository when missing or stale, instead of asking the user again. Use before non-trivial work on an unfamiliar project, when asked to test or verify a build, and before anything deploy-related.
owner: nexo
version: 1.0.0
---

# nexo-infra

Read `context/infra.md` first. If it is missing or no longer matches the repository, discover and write it.

## Discover

In `code/`, look for:
- A `Makefile` with run/build targets — if there is one, it is the intended interface: use it.
- `docker-compose*.yml`, `Dockerfile*`, a `docker/` folder.
- Package scripts (`package.json` `dev`/`build`/`start`, `pyproject`, `go` commands…).
- `.env.example` / `.env.*` — which variables exist, never their values.

## Write `context/infra.md`

1. **Run it locally** — the command, ports, services, what to open.
2. **Validate a production build** — how to build the production artifact or images from scratch, locally.
3. **Deploy** — only if a real process exists (CI, a server), kept apart from "validate": validating is not
   deploying.
4. **Checks** — the project's test, typecheck and lint commands (also listed in its `AGENTS.md`).

## Validate before any deploy talk

Never say a change is ready to deploy without building the production artifact from scratch in this
session. A build-only step is the safe default. Bringing a full production stack up locally can make real
calls if its env file holds live keys: check what is live first and say so, don't do it silently. A failing
build is the thing to fix or report — never route around it.

## Does not

- Deploy, push or touch production on its own.
- Copy secret values into `context/`.
