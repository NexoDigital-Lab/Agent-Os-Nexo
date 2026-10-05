---
name: nexo-research
description: Research a topic, API, library or URL against primary sources and leave a short report with citations. Use for "investigate", "research", "how does X work", or before integrating an unfamiliar API.
owner: nexo
version: 1.0.0
---

# nexo-research

Facts from primary sources, written down once so nobody researches the same thing twice.

## Steps

1. Check first: `projects/<name>/context/research/` and `library/memory/` may already answer it.
2. State the question and what decision it feeds.
3. Prefer primary sources: official docs, specs, source code, changelogs. Open the pages you cite;
   a search snippet is not a source.
4. Note versions and dates — APIs change.
5. Write `context/research/<slug>.md` (project) or reply inline for quick questions.

## Report shape

```markdown
# <question>
**Answer:** one paragraph.
**Applies to:** versions / dates.
## Details
## Sources
- [title](url) — what it supports
```

## Does not

- Present memory as sourced fact. Unverified claims are labeled as such.
- Change code.
