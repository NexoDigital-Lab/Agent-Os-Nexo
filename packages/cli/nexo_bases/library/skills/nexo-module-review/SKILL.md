---
name: nexo-module-review
description: Review an agent-os-nexo module (or a change to one) against the module rules and report what to fix, by rule, severity and file:line. Use when asked to review a module, a PR or branch that touches modules, the user's os/source before a build, or code a third party wrote for agent-os-nexo.
owner: nexo
version: 1.0.0
---

# nexo-module-review

The rules live with the code: `docs/en/module-rules.md` (Spanish: `docs/es/module-rules.md`) in the
agent-os-nexo source — `os/source/docs/` in an environment, `apps/os/docs/` in the Nexo repository. The full
method is `docs/en/review.md`. Read both before the first review in a session; cite rules by ID (M1–M6,
R1–R12).

## Steps

1. **Scope.** Name what is reviewed (a module, a diff, the whole `os/source`). Read the module's
   `module.json`, its entry in `docs/en/modules.md`, and the code (the diff, or every file if new).
2. **Machine checks** — run them, never assume:
   - `nexo os check [--module <id>]` in an environment, or `node scripts/check-modules.ts` in the repo;
   - `npm run check` where the code lives (types and tests).
   Every M finding, type error or failing test is a **blocker**.
3. **Read for R1–R12** with the checklist in `review.md`. Look hardest at R3 (input validation,
   `safePath`, processes with argument lists), R4 (where data lives, atomic writes, no secrets),
   R5/R6 (extension points instead of edits, `isActive` for submodules) and R9 (what agents can reach).
4. **Look for plain bugs:** a slow response overwriting a newer one, timers/listeners/processes never
   cleaned up, error paths that leave state half-written.
5. **Verify each finding** — run the path, write the failing input, or point at the exact line. Drop
   what you cannot back up, or mark it *unverified*.
6. **Report**, most severe first, one line each:
   `[blocker|major|minor] <rule> <file>:<line> — what goes wrong (concrete). Fix: what to do.`
   Close with counts per severity and a verdict: *can be built/merged* only with zero blockers.

Answer in the user's language; rule IDs, paths and code stay as they are.

## When asked to fix

Fix blockers first, one rule at a time; add a regression test for each bug (R10); re-run step 2 and show
its output. Bump the module's `version` (R11) and update `docs/en/modules.md` and `docs/es/modules.md`
when routes, slots or data change.

## Does not

- Approve without having run step 2 in this session.
- Restyle code the rules don't cover, or rewrite a module when a targeted fix does.
- Build or restart agent-os-nexo (`nexo os build` / `start` are the user's call).
