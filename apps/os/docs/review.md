# Reviewing a module

How anyone — a maintainer, a contributor, or an agent asked to "review this module" — checks a module
against [module-rules.md](module-rules.md) and reports what to fix. The factory skill
`nexo-module-review` follows these steps.

## 1. Scope

Name what is under review: one module (`modules/<name>`), a branch or PR, or the user's `os/source`.
Read the module's `module.json`, its entry in [modules.md](modules.md), and the diff (or every file, for a
new module).

## 2. Machine checks first

```bash
node scripts/check-modules.ts --module <id>   # in this repo (or: nexo os check --module <id>)
npm run check                                 # typecheck + every test
```

Every M finding is a **blocker**; copy them into the report as they come. Failing tests or types are a
blocker too.

## 3. Read for the R rules

Go through the code with the list below; each item names its rule.

- **R1** layout: the expected files, a header comment on each.
- **R2** names and routes under the module's own prefix; CSS classes prefixed.
- **R3** each route validates its input; errors use `httpError` with the right status; paths through
  `safePath`; processes with argument lists; nothing heavy in `register`.
- **R4** data in the right place; JSON written atomically; no secret in clear text or in a log.
- **R5** no edits to other modules to plug in; new extension points live in their owner and are documented.
- **R6** submodule components rendered only behind `isActive`; the parent works with them off.
- **R7** host classes and helpers reused; full width; loading, empty and error states; accessibility;
  `ConfirmDelete` for destructive actions; polling hygiene.
- **R8** every visible string through `t()`, placeholders instead of glued fragments.
- **R9** agent tools gate themselves; text to agents redacted; no new listeners; WebSockets check origin.
- **R10** tests for branching logic; a regression test for each bug fixed.
- **R11** version bumped by the right step; [modules.md](modules.md) and the manifest description true.
- **R12** strict types, no stray `any`/`!`, no non-erasable TypeScript.

Then look for plain bugs: race conditions (a slow response overwriting a newer one), missing cleanup
(timers, listeners, processes), off-by-one, error paths that leave state half-written.

## 4. Verify before reporting

A finding states what happens, not what might: run the code path, write the failing input, or point to
the exact line. Drop what you cannot back up, or mark it **unverified**.

## 5. Report

One line per finding, most severe first:

```
[blocker] R3 modules/foo/server/index.ts:42 — POST /api/foo/items accepts any `name` (no length check):
          a 10 MB name is written to os/data/foo/items.json. Fix: reject names over 120 characters with 400.
[major]   R7 modules/foo/web/List.tsx:18 — no empty state: an empty list renders a blank card.
          Fix: <p className="empty">{t("No items yet.")}</p>.
[minor]   R2 modules/foo/web/foo.css:3 — class .row has no module prefix. Fix: .foo-row.
```

Each line: severity, rule, `file:line`, what goes wrong (concrete), and the fix. Close with the counts
per severity and whether it can be merged or built (no blockers) — never "looks good" without having run
step 2.
