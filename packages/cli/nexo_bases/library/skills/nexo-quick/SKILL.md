---
name: nexo-quick
description: The light lane for a small, clear change — at most 3 files, no risk signal, no new module or public API. One focused change, verified, without plans or review panels. Use for "quick fix", copy tweaks, a small bug, adding a field, wiring an existing pattern into one more place.
owner: nexo
version: 1.1.0
---

# nexo-quick

Most changes don't need the full `nexo-dev` flow. This is the lane for those.

## Gate — is it really quick?

Go on only if all of these hold:
- **3 files or fewer**, and you can name them now.
- **Clear result**: no design decision open.
- **No risk signal** (the list in `nexo-budget`): not auth, tenant scoping, payments, migrations or secrets.
- **No new module and no new public API.**

If one fails: say which, and offer `nexo-dev` instead. If the change grows past this while you work, stop
and say so.

## Work mode

Follow the session's mode (`nexo-dev` table). In Practice mode you don't edit `code/`: say so and let the
user choose.

## Steps

1. Branch per `library/conventions/git/` unless it's a one-liner or the user works on main.
2. Find the code through the project's index, `context/map/README.md` and its `routes.md`/`symbols/`
   (`nexo map` if missing or stale), then read only the
   files you will change.
3. Make the change in the surrounding style. Nothing beyond what was asked.
4. Verify: the project's checks from its `AGENTS.md` for the touched code, run now, output read. Something
   that renders gets a look in a browser.
5. Report: files, the commands run and their result.
6. Commit only if the user asks. If the change alters documented behavior, update the feature or
   `context/` line that describes it.

## Does not

- Write a plan document, dispatch review agents, or log a run — if you want those, use `nexo-dev`.
