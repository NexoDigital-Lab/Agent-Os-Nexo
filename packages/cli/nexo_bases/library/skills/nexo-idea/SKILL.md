---
name: nexo-idea
description: Turn a raw idea into an options document without deciding for the user. Use when the user says "I have an idea", "nexo-idea <idea>", "let's think about", or asks for proposals for something new.
owner: nexo
version: 1.0.0
---

# nexo-idea

New ideas get **options**, not a decision. The user decides later; `nexo-ticket` turns the chosen
option into work.

## Steps

1. Restate the idea in one sentence and confirm the goal. If the user asked for "just proposals",
   do not ask questions — generate.
2. Ground it: read the project's `context/` and look at the code the idea touches.
3. Produce 2–4 genuinely different options. For each: what it is, when to pick it, cost, risk,
   what it leaves out.
4. Challenge your own options: what would make each fail? Is there a cheaper path that covers 80%?
   Add what this changes.
5. Mark at most one as recommended, with the reason.
6. Write `projects/<name>/context/proposals/<slug>.md` (or reply inline if the user prefers chat)
   and list the open questions at the end.

## Template

```markdown
# <idea>

**Goal:** … · **Date:** YYYY-MM-DD · **Status:** options, not decided

## Options
### A — <name>
What · When to pick it · Cost · Risks · Leaves out

## Recommendation
## Open questions
```

## Does not

- Pick an option or start implementing.
- Write tickets — that is `nexo-ticket`, after the user chooses.
