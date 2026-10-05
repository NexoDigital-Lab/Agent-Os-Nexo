---
name: nexo-dev
description: Build a feature or fix a bug end to end, with a plan gate, verification and a local commit. Use when the user says "nexo-dev <feature>", "build this", "fix this bug", or points at a file in context/features/.
owner: nexo
version: 1.2.0
---

# nexo-dev

The standard way to turn a feature into verified, committed code. Scales with the feature size.

## Input

A feature (`context/features/<id>-*.md`) or a request. No feature yet → run `nexo-features` first.
A change of 3 files or fewer with no risk signal and a clear result → `nexo-quick` instead.

## 0. Mode and size

- **Size**: take it from the feature (S/M/L, see `nexo-features`). Propose a different size if the
  code says otherwise; the user can always change it.
- **Work mode** — ask once per session if unknown:

| Mode | You | The user |
|---|---|---|
| Relax | Plan, build, verify, report at the end | Approves the plan and the result |
| Medium | Pause after each section and explain its logic | Follows along |
| Focus | Brief each sector *before* writing it and wait for OK | Approves sector by sector |
| Practice | Guide only: pointer → approach → skeleton → snippet on request; never edit `code/` | Writes the code |

In every mode you may handle environment work (dependencies, containers, config) yourself.

## 1. Context

Read the project `AGENTS.md`, `context/README.md`, the feature, and only the conventions the task
needs (`library/index.json` first). Start from `context/map/README.md` and its detail files (`nexo map` when missing or
stale) instead of exploring cold; how to run and build the project is `context/infra.md` (`nexo-infra`).
Check `blueprints/index.json` for a matching blueprint.

## 2. Plan — GATE 1

Write a short plan: files to change, approach, risks, how it will be verified. For M/L list the
tasks in order, and run `nexo-budget` on it: its signals, review set and model routing go with the
plan, and the user picks recommended, lighter, heavier or manual. For L (or an ambiguous request),
`challenger` reviews the request first. Present it with the size and mode, and **wait for approval**.
Size S: a three-line plan is enough.

## 3. Build

- Create the branch from `library/conventions/git/` unless the user said to work on main.
- Size S: implement directly.
- Size M: implement task by task; review your own diff after each task.
- Size L: implement task by task; at the end dispatch the review set `nexo-budget` chose
  (`library/agents/`: `code-reviewer`, `simplifier`, `security-reviewer`, `critic`) on the whole diff,
  with its model routing. Respect the model ceiling in `profile.json`.
- Fix every real finding; say which findings you rejected and why.

## 4. Verify

Run the project's checks from its `AGENTS.md` (tests, typecheck, build). Anything that renders in
a browser is verified in a real browser. Paste the evidence. **Never claim success without it.**

## 5. Result — GATE 2

Report: what changed (files), how it was verified (commands + outcome), what is left. Wait for
approval.

## 6. Close

1. Commit following `library/conventions/git/` (identity from `profile.json`). Do not push unless
   the user asks and permissions allow it.
2. Update the feature: `status: done`, plus a short "What was done" section.
3. Record decisions or new knowledge in `context/` (and `library/memory/` if it holds across
   projects).
4. M/L: run `nexo-budget`'s learning step (one line in `context/pipeline/runs.md`).
5. If something was hard to set up and is reusable, **ask** whether to save it with
   `nexo-blueprint`.

## Does not

- Skip gate 1 or gate 2, even for size S (they can be one line each).
- Push, open PRs or deploy on its own.
