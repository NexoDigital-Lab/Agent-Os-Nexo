---
name: nexo-dictionary
description: Save and look up the user's concepts in library/dictionary/ so they never have to explain a term twice. Use when the user defines or corrects a concept ("guardá X", "acordate que X es…", "X significa…", "save this term", "remember that X means…"), and before asking the user what a word, client, product or abbreviation means.
owner: nexo
version: 1.0.0
---

# nexo-dictionary

The user's own vocabulary — clients, products, internal names, abbreviations, business rules with a name — lives
in `library/dictionary/`, one file per concept. `library/index.json` lists every term with a one-line summary, so
you already know what is defined before opening anything.

## Look up first

When a word in the task is unclear, check `library/index.json` → `dictionary` (term, aliases, summary). Open the
file (`path`) only when you need the full definition. Ask the user only if it is not there.

## Save when the user defines something

When the user states what a concept means — or corrects a definition — save it right away. Writing to
`library/dictionary/` is allowed by `permissions.json`, so you do not need to ask:

```bash
nexo dict add "<term>" --summary "<one line: what it means>" [--alias "a,b"] [--body "<details, examples, rules>"]
```

- **Summary**: one line, in the user's words and language. It is what every agent reads in the index.
- **Aliases**: other names the user uses for it (abbreviations, the other language, the old name).
- **Body**: whatever else they said that matters (how it is computed, examples, exceptions). Keep it short.
- Saving a term or alias that exists **updates** it: aliases merge, summary and body are replaced only if given.
- Rename: `nexo dict add "<new name>" --from "<old name>"`.
- Remove only when the user asks: `nexo dict rm "<term>"`.

Then say it in one line ("Guardé *Cliente activo* en el diccionario."). Never store secrets, credentials or
personal data about third parties in the dictionary.

## Other commands

`nexo dict list`, `nexo dict show "<term>"` (both accept `--json`). The agent-os Dictionary view edits the same
files.
