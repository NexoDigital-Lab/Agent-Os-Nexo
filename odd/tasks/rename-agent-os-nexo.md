# Feature: rename agent-os → agent-os-nexo

Project bookkeeping only. Personal session rules and credential details are intentionally NOT stored
here (they live outside the repository).

## Objective

Rename every trace of the product identifier `agent-os` to `agent-os-nexo` across code, docs, tests,
npm package names, the X-Agent-OS protocol header and the desktop app identity, so the tree matches
the repo name (Agent-Os-Nexo) and the root package name (`agent-os-nexo`). GitHub CI must pass.

## Outcome

- Branch `refactor/agent-os-nexo`, commit `7ff3940` `refactor: rename agent-os to agent-os-nexo across
  code, docs and packages` (141 files). Leftover scans clean; header contract moved together
  (server, CLI, Rust, tests, EN/ES docs).
- **PR #3**: https://github.com/NexoDigital-Lab/Agent-Os-Nexo/pull/3 (base `main`). No issue-form or
  PR-validation workflow exists in this repo; PR is not issue-linked.
- `npm run check` green on the rename branch (CLI 73/73; apps/os 445 pass / 0 fail / 38 platform
  skips). `npm run build` and the apps/os build script green. Coverage on Windows alone under-shoots
  on `modules/projects/server/lifecycle.ts` (tests skip on win32; pre-existing, not rename-caused);
  CI coverage runs ubuntu-latest.
- Native review (RDD on): consent envelope returned high risk; this runtime exposes no native
  question UI, so no receipt exists for the candidate. Delivery stays under ordinary repo policy.

## npm packages (published)

- Scope corrected `@nexodigital-lab` → `@nexodigital` in 14 files, commit `80326db` on branch
  `chore/npm-scope-nexodigital`. GitHub org `NexoDigital-Lab` unchanged (npm scope only).
- `apps/os` un-privated. Published:
  - `@nexodigital/agent-os-nexo@1.0.0` — app source (target of `nexo os install` / OS_PACKAGE)
  - `@nexodigital/nexo@0.1.0` — CLI (`npm install -g @nexodigital/nexo`)
  Names stay distinct on purpose: OS_PACKAGE downloads app source (needs `modules/`); the CLI
  tarball does not.
- Registry state: packages accepted by npm (`npm access list` shows read-write) but not yet on the
  public packument — pending org admin approval of staged packages.
- `.gitignore` ignores `.env` / `.npmrc` (commit `ffb25d4` on `fix/docker-windows-cli`, verified with
  `git check-ignore`). Credential material lives only in the gitignored `.env`, never in the repo.

## Environment build (local)

- Environment root `C:\Users\erosd\environments`. Source updated from the rename branch via
  `nexo os update --from <repo>/apps/os` (clean merge, no conflicts).
- Active build: `agent-os-nexo 1.0.0 (of 1 build(s))` — rename + night-greeting fix included.
- Night greeting fix: branch `fix/home-greeting-night`, commit `2e48cdb` (morning 5–12, afternoon
  13–19, evening 20–4). Server answers with header `X-Agent-OS-Nexo: 1`.

## Other branches (ready, not PR'd yet)

- `chore/npm-scope-nexodigital` — `@nexodigital` scope + un-privated apps/os (commit `80326db`).
- `fix/docker-windows-cli` — Windows Docker failures ask to install Docker Desktop (commit
  `bb4dd66`; RDD assess medium, `under_budget`).
- `fix/home-greeting-night` — night greeting in the early morning (commit `2e48cdb`).

## Next step

User decides: approve staged npm packages; open follow-up PR(s) after #3; specify remaining work
before the second PR.
