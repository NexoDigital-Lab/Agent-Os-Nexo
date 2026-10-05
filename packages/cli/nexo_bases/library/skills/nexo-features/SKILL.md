---
name: nexo-features
description: Turn a request or idea into a feature in the project's context/features/ (alias CT). Use when the user says "CT", "create a feature", "make this a task", or hands over work to be done later.
owner: nexo
version: 1.0.0
---

# nexo-features (CT)

Turns a request into one feature file that `nexo-dev` can execute later without re-asking.

## Input

The user's request, plus the project. If the project is unclear, ask which one.

## Steps

1. Read `projects/<name>/AGENTS.md` and `projects/<name>/context/README.md` (or the part's, inside
   a `-ws`).
2. Look only at the code needed to locate the change (search, don't read whole folders).
3. If something essential is ambiguous (scope, expected behavior), ask **at most three** questions.
   Otherwise write the feature with explicit assumptions.
4. Pick the next id: highest number in `context/features/` + 1, zero-padded (`0007`).
5. Write `context/features/<id>-<slug>.md` using the template below.
6. If the project lists a task-tracker connection (Notion, GitHub Issues…) in its `AGENTS.md` and
   permissions allow it, create the feature there too and store its URL in `link`.
7. Reply with the id, title, size and the file path. Do not start working on it.

## Template

```markdown
---
id: "0007"
title: <short imperative title>
type: feature | bug | chore
size: S | M | L
priority: P0 | P1 | P2 | P3
status: todo
link: <external URL or empty>
created: <YYYY-MM-DD>
---

## Context
Why this is needed; what exists today.

## Acceptance criteria
- [ ] Observable, testable outcomes.

## Likely files
- `code/path/to/file` — why

## Assumptions and open questions
```

## Sizing

| Size | Rule of thumb |
|---|---|
| S | 1–3 files, no risk signal (auth, payments, data migrations, secrets, multi-tenant) |
| M | Several files or one risk signal |
| L | Cross-cutting, several risk signals, or a new module |

Priority: P0 urgent (blocks work or users), P1 next, P2 normal (default), P3 someday.

## Does not

- Implement anything.
- Create features in external services without the permission to write there.
