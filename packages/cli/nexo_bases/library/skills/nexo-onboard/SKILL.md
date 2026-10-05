---
name: nexo-onboard
description: Fill a project's AGENTS.md and context/ after `nexo clone` or `nexo new` — stack, how to run and validate, rules, a map of the code. Use when a project's AGENTS.md still has empty sections or the user says "onboard <project>".
owner: nexo
version: 1.1.0
---

# nexo-onboard

Makes a freshly cloned project workable without re-exploring it every session.

## Steps

1. Read `projects/<name>/AGENTS.md` (template) and `context/README.md`.
2. Detect the stack from manifests (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`,
   `docker-compose*.yml`, CI files). Read the repo's own README.
3. Find how to install, run, test and build with `nexo-infra` (it writes `context/infra.md`). Prefer
   commands that already exist in the repo (scripts, Makefile). Run the cheap ones (install, tests) to
   confirm they work; ask before anything slow or with side effects.
4. Fill `AGENTS.md` sections **Stack** and **How to run and validate** with exact commands.
   Ask the user for **Project rules** (production limits, branches, clients).
5. Run `nexo map` (the code map in `context/map/`) and write `context/overview.md`: top-level folders
   and the main entry points, one line each.
6. Report what you filled and what still needs the user.

## Does not

- Write anything inside `code/`.
- Run migrations, deploys or anything touching shared environments.
