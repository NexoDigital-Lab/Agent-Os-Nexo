---
name: nexo-ticket
description: Turn a request or idea into a ticket in the project's context/tickets/ (alias CT). Use when the user says "CT", "create a ticket", "make this a task", or hands over work to be done later.
owner: nexo
version: 1.0.0
---

# nexo-ticket (CT)

Turns a request into one ticket file that `nexo-dev` can execute later without re-asking.

## Input

The user's request, plus the project. If the project is unclear, ask which one.

## Steps

1. Read `projects/<name>/AGENTS.md` and `projects/<name>/context/README.md` (or the part's, inside
   a `-ws`).
2. Look only at the code needed to locate the change (search, don't read whole folders).
3. If something essential is ambiguous (scope, expected behavior), ask **at most three** questions.
   Otherwise write the ticket with explicit assumptions.
4. Pick the next id: highest number in `context/tickets/` + 1, zero-padded (`0007`).
5. Write `context/tickets/<id>-<slug>.md` using the template below.
6. If the project lists a ticket connection (Notion, GitHub Issues…) in its `AGENTS.md` and
   permissions allow it, create the ticket there too and store its URL in `link`.
7. Reply with the id, title, size and the file path. Do not start working on it.

## Template

```markdown
---
id: "0007"
title: <short imperative title>
type: feature | fix | chore
size: S | M | L
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

## Does not

- Implement anything.
- Create tickets in external services without the permission to write there.
