---
name: nexo-dev
description: Work a ticket end to end — fix or feature — with a plan gate, verification and a local commit. Use when the user says "nexo-dev <ticket>", "build this", "fix this ticket", or points at a file in context/tickets/.
owner: nexo
version: 1.0.0
---

# nexo-dev

The standard way to turn a ticket into verified, committed code. Scales with the ticket size.

## Input

A ticket (`context/tickets/<id>-*.md`) or a request. No ticket yet → run `nexo-ticket` first.

## 0. Mode and size

- **Size**: take it from the ticket (S/M/L, see `nexo-ticket`). Propose a different size if the
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

Read the project `AGENTS.md`, `context/README.md`, the ticket, and only the conventions the task
needs (`library/index.json` first). Check `blueprints/index.json` for a matching blueprint.

## 2. Plan — GATE 1

Write a short plan: files to change, approach, risks, how it will be verified. For M/L list the
tasks in order. Present it with the size and mode, and **wait for approval**. Size S: a three-line
plan is enough.

## 3. Build

- Create the branch from `library/conventions/git/` unless the user said to work on main.
- Size S: implement directly.
- Size M: implement task by task; review your own diff after each task.
- Size L: implement task by task; at the end dispatch review subagents (`library/agents/`, e.g.
  `code-reviewer`, plus `security-reviewer` when there is a risk signal) on the whole diff.
  Respect the model ceiling in `profile.json`.
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
2. Update the ticket: `status: done`, plus a short "What was done" section.
3. Record decisions or new knowledge in `context/` (and `library/memory/` if it holds across
   projects).
4. If something was hard to set up and is reusable, **ask** whether to save it with
   `nexo-blueprint`.

## Does not

- Skip gate 1 or gate 2, even for size S (they can be one line each).
- Push, open PRs or deploy on its own.
