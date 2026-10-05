# AGENTS.md — {{name}}

Project rules. The environment rules in the root `AGENTS.md` still apply; this file only adds what
is specific to this project. Keep it short: details belong in `context/`.

## Layout

| Path | What |
|---|---|
| `code/` | The repository. Never add work conventions or notes here. |
| `context/` | Everything for the AI: specs, business rules, decisions, features. Start at `context/README.md`. |
| `context/features/` | Features created with `nexo-features` |
| `context/permissions.json` | Overrides the global permissions for this project |
| `secrets/` | Credentials for this project. Never print or commit them. |

## Stack

<!-- filled by nexo-onboard: languages, frameworks, package manager -->

## How to run and validate

<!-- filled by nexo-onboard: install, dev server, tests, production build -->

## Project rules

<!-- e.g. "production: read-only SQL, deploy only via git pull" -->
