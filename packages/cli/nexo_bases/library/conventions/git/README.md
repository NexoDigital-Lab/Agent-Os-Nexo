---
name: git
description: Commit, branch and pull request conventions. Read before any commit, branch or PR.
owner: nexo
version: 1.0.0
---

# Git conventions

Factory defaults. To change them, copy this folder's content into your own file, set
`owner: user`, and edit it; `nexo update` will then leave it alone.

## Commits

- English, imperative mood, describing the actual change: `Add ticket sync to Notion`, not
  `changes` or `fix stuff`.
- Subject ≤ 72 characters; a body explains *why* when it is not obvious.
- One logical change per commit.
- Author: the identity in `library/profile.json`. Never override it with another name or email.
- No AI co-author trailer unless `profile.json` sets `git.aiCoAuthorTrailer: true`.
- Never commit secrets, `.env` files with values, or anything under `secrets/`.

## Branches

- One branch per ticket: `feat/<ticket-id>-<slug>`, `fix/<ticket-id>-<slug>`, `chore/<slug>`.
- Work on the project's main branch only when the user says so.

## Push and pull requests

- Pushing and opening PRs follow `permissions.json` (factory presets: `ask`).
- Never force-push to the main branch.
- `nexo-dev` stops at the local commit; the user decides when to push.
