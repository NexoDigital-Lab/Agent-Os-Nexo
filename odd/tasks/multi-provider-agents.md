# Feature: multi-provider AI agents

Project bookkeeping. Personal session rules live outside the repo.

## Objective

agent-os-nexo today is Claude-only in the app while the CLI already knows four AIs
(`claude`, `codex`, `gemini`, `opencode` — `packages/cli/src/core/config.ts`). Make the OS app
provider-agnostic: the user chooses one or more providers; the app detects what is installed and
routes AI work through the choice. Linux + Windows.

## Research (verified 2026-10-07)

- Sessions run the **Anthropic SDK `query()` only** — no binary spawn. Seam: `sessions/server/agent.ts`
  (`runQuery`/`setQueryFn`) + `sessions/server/claude.ts` (injectable QueryFn façade used by
  extensions, skills, notes, architecture, practice, monitor).
- CLI `init` already asks which AIs to enable and writes `tools` in `environment.config.json`;
  **apps/os never reads `tools`** — the two halves are desynced.
- No API-key plumbing anywhere; each CLI owns its own login state (keep it that way — the app never
  handles secrets).
- Google: Gemini CLI was replaced by **Antigravity CLI** (binary **`agy`**; headless `agy -p`,
  `AGY_ERROR` JSON on stderr, `GEMINI_API_KEY` sessions). Legacy `gemini` binary may still exist.
- Local probes: `opencode` ✓ (ps1 shim — needs .cmd sibling rule), `gemini` ✓, `claude`/`codex`/`agy` ✗.
- Windows lesson (repeated this session): execFile cannot run `.cmd`/`.bat`; resolve shims via
  `findBin("x.cmd")` + `cmd.exe /c`. Bake ONCE into a shared resolver.

## Design decisions (made this session)

1. **Providers v1**: `claude` (SDK, bundled — reference impl), `opencode` (CLI headless), `codex`
   (CLI `codex exec`), `antigravity` (CLI `agy`, fallback binary `gemini` as legacy install).
2. **Seam**: new shared `apps/os/host/server/providers.ts` — registry, platform-aware binary
   resolution, detection (CLI-first, Docker-card pattern), install hints. `claude.ts`/`agent.ts`
   become adapters over the registry; non-Claude providers are CLI kind (spawn headless).
3. **Auth stays per-CLI**: app never stores keys; Providers view shows detect status + install/login
   hints only.
4. **First-run UX (my call, user delegated)**: NON-blocking. Home shows a dismissible strip when no
   provider is detected/enabled → links to Settings → Providers. No modal wizard: detection races
   boot, power users hate blocking, install can happen later. Settings gets a Providers section in
   the existing section-registry pattern (same UX language as the Docker CLI card).
5. **Config**: read `environment.config.json` `tools` (CLI already writes it) + `library/providers.json`
   for enabled set / default provider. `host/server/env.ts` exposes `tools` to the app.
6. **Sessions routing (v1 honesty)**: Claude keeps full SDK parity (resume, hooks, MCP, permissions).
   Non-Claude providers serve one-shot AI calls and session turns via headless CLI with cwd=
   project; no resume/history parity in v1 (documented limitation), Composer shows the provider.
7. **Cost/usage ledger** stays Claude-transcript-based in v1 (non-Claude turns report unknown cost).

## Out of scope (v1)

- Secret storage / key management UI.
- Full SDK parity (hooks, MCP, permission prompts) for non-Claude providers.
- `monitor` usage probes beyond Claude; usage.ts price tables for other vendors.
- Publishing/npm version bumps (version stays 1.0.0 until the user says otherwise).

## Tasks

- [x] T0 — Explore Claude surface; confirm Antigravity CLI facts; create branch
      `feat/multi-provider-agents` (from `fix/os-header-compat`).
- [x] T1 — `a8c8d50` registry + detection (resolveCli: .cmd via cmd.exe) + providers rail view +
      `library/providers.json` + env.tools exposure + 14 tests.
- [x] T2 — `4a64375` askWithProvider headless runners (opencode run / codex exec / agy -p),
      claude.ts ask() provider routing, structured() claude-only (502 otherwise), session provider
      field + send() CLI path, Composer provider picker, Home non-blocking strip. 486/0 green.
- [x] T3 — `bb45b60` docs EN/ES (modules, security, module-api, lifecycle). Docs completeness green.
- [x] T4 — `fa25642` win32 `.cmd`-first shim fix (execFile cannot run .cmd directly; matching tests).
- [x] T5 — `4e4d8b0` agent/model pickers: `supports` flags per provider, `headlessArgs` model/agent
      opts (opencode `--model/--agent`, codex `--model`, antigravity none), `listProviderChoices`
      (opencode `agent list` + `models`, 60s cache), `GET /providers/choices?project=`,
      session `providerAgent` stickiness, Composer agent/model controls + EN/ES strings, docs
      routes updated. 499/0 green (499 pass, 38 skipped, check-modules + docs index exit 0).
- [x] T6 — pushed (`4e4d8b0`, `65390eb`); env rebuilt at 1.0.0 (stop → `os update --from` → clear
      `os/versions/*` → `os build` → `os start`, pid 31540). Probed live: `/api/providers` exposes
      `supports` (claude model, opencode agent+model, codex model, antigravity none; default now
      opencode), `GET /providers/choices?id=opencode&project=…` returns 34 agents (incl.
      sdd-orchestador-shini-orchestrator) + 41 models (incl. opencode-go/mimo-v2.6-pro) in ~3.4 s.
      First cold call returned empty once (CLI warmup) — failure path is not cached (regression test
      `65390eb`), retry succeeded. `npm run check` 500/0/38. Engram mirror of this doc still PENDING:
      no mem_* tools exposed in this runtime.

## Round 2 — codex / antigravity / Google CLI parity (verified 2026-10-07)

Verified facts (official docs + local probes):

- **agy** (Antigravity CLI, antigravity.google/docs/cli/headless): `agy -p "prompt"`; `--model <slug>`
  (e.g. `gemini-3.5-flash-medium`); `--agent <name>` listed by **`agy agents`** (official docs quote:
  "Select an agent (list them with `agy agents`)"); models listed by **`agy models`** (agy docs +
  community adapters). `agy` NOT installed on this machine.
- **codex**: `codex exec "prompt"`; `--model/-m`; `--profile <name>` loads config layer
  `~/.codex/<name>.config.toml` (codex ≥0.134; legacy `[profiles.<name>]` in `config.toml` before).
  No `codex profile list` subcommand exists; no stable models list (`codex debug models` is
  Experimental → not shipped). codex NOT installed locally → profiles enumerable by scanning
  `$CODEX_HOME ?? ~/.codex` for `*.config.toml` (no spawn needed).
- **gemini** (Gemini CLI 0.53.0, installed; verified from `gemini --help`): `-m/--model`, `-p`
  headless; extensions are the selectable unit: `-e/--extensions <list>`, listed by `gemini -l`
  (list-and-exit, clean empty output exit 0 on this machine). No models list command → model free
  text. `gemini skills list` boots MCP servers (noisy, slow) → rejected as the list source.
- On this machine `agy` is absent, so provider `antigravity` currently reports found via the legacy
  `gemini` fallback — confusing UX and the reason for the split below.

Decisions (round 2):

8. **Split the legacy merge**: `antigravity` = binaries `["agy"]` only; NEW provider id `gemini`
   (label "Gemini CLI", binaries `["gemini"]`, install hint `npm install -g @google/gemini-cli`).
   Matches nexo config `tools` value `gemini` and the user's request ("google cli" as its own
   item). Design decision 1's "fallback binary gemini" is retired.
9. Capabilities after round 2: claude `{model}`, opencode `{agent,model}`,
   codex `{agent: profiles, model}` (model free text — no stable list command),
   antigravity `{agent: agy agents, model: agy models}`, gemini `{agent: extensions via -e, model}`
   (model free text).
10. `headlessArgs`: codex `exec [--model m] [--profile a] <prompt>`; agy `-p <prompt> [--model m]
    [--agent a]`; gemini `-p <prompt> [--model m] [--extensions e]`.
11. `listProviderChoices` branches: opencode spawn (existing); codex fs scan of profiles (no
    spawn); antigravity spawn `agy agents` + `agy models`; gemini spawn `gemini -l`; claude/other →
    empty, no spawn. Conservative line parsers (strip ANSI/decor, drop noise/sentences); any
    failure or unparseable output → empty lists (Composer falls back to free text), never cached
    (existing rule). Model validation charset must accept display names with spaces/parens
    (agy models) while still excluding shell metacharacters.

## Tasks (round 2)

- [x] T7 — implemented by bounded writer (RED: 13 old-design tests failed → GREEN: 34/34 in
      providers.test.ts). Registry split + gemini entry, per-provider headlessArgs
      (`--profile`/`--agent`/`--extensions`), `listProviderChoices` four branches with shared
      `parseNames` + `codexProfiles` fs scan, widened `CHOICE_RE` (kept `:` — `gpt-5:mini` test
      outside editable surfaces) + narrow `AGENT_RE`, Composer tooltip + "Gemini CLI" label,
      docs EN/ES + index. Deviation: tooltip edit landed in `web/chat/Composer.tsx` (real path;
      the spec's `web/Composer.tsx` was wrong).
- [x] T8 — parent re-ran `npm run check` itself: 544 tests, 506 pass, 0 fail, 38 skipped,
      exit 0 (includes check-modules + docs-index tests). check-modules + docs exit 0 (writer).
- [x] T9 — `2aebd6c` pushed. Env rebuilt at 1.0.0 (stop → update --from → clear
      `os/versions/1.0.0` → build → start; pid 48436, port 4780, token in app.log ?token=).
      Live probes: `/api/providers` → 5 providers (claude T/model, opencode T/T, codex
      F/T+T, antigravity F/T+T — no longer matches legacy gemini, gemini T/T+T; default
      opencode; enabled set = persisted `claude,opencode,antigravity` — gemini not yet enabled
      by the user). `/choices`: gemini 200 empty/empty (no extensions), **codex 200
      agents=[sdd-cheap, sdd-mid, sdd-strong]** (real `~/.codex/*.config.toml` profiles found on
      disk without the binary), antigravity 200 empty/empty (agy ENOENT, not cached).

## Round 3 — user bug reports (2026-10-08, branch `06-fixes`)

User testing found two bugs; fixes ride the chain as slice 06 (base: `05-choices`).
Delegation note: subagents unavailable this environment (free-tier refusal) — explored
and implemented inline with bounded reads; evidence in commits below.

- [x] T10 — CLI session turns die at 120 s: fixed — `runCliTurn` passes `CLI_TURN_MS = 600_000`
      (`agent.ts`); one-shots keep 120 s. RED: `expected: 600000` failed against 120000; GREEN 30/30
      on the touched suites. Commit `bb3fede`.
- [x] T11 — Recommender Claude-only: fixed — route validates `provider`, resolves project cwd;
      `recommendSkills` runs CLI providers through `askWithProvider` (JSON answer, fence-tolerant,
      unparsable → pinned only, cost 0); Claude path unchanged. RED: old path failed both new tests;
      GREEN after implementation. Full `npm run check`: 546 tests / 508 pass / 0 fail. Commit `31ef78f`.
      RDD assess on the slice: risk **medium**, `review_due: false` (`under_budget`, 146/400).

## Deviations from the original design (code won)

- Providers ships as a **rail view** (nav label "Providers", order 60), not a Settings section —
  better discoverability; docs follow the landed code.
- Home strip condition: fires when no **enabled** provider is found (claude always reports found:true
  as the bundled SDK, so "all found===false" could never fire).

## v1 limitations (honest, documented in docs/security.md)

- Resume/history: Claude-transcript only (`~/.claude/projects`); CLI sessions are in-memory.
- structured() one-shots: Claude only (502 otherwise, no silent fallback).
- CLI turns: no confineHook, no MCP/hooks/permission mediation; usage/cost not recorded (cost 0).
- Interrupt does not kill CLI children in v1; stopTask 409s during a CLI turn.

## Delivery

Chain strategy (user-chosen, 2026-10-08): **Feature Branch Chain with tracker**; maintainer
accepted `size:exception` for the four over-budget slices ("Vamos con la A"). PRs only — merges
are the user's. Version stays 1.0.0. No issue linkage (repo has none; precedent PRs #1–#4).

| # | PR | Base | Slice / commits | Lines | Label |
|---|----|------|-----------------|-------|-------|
| 6 | tracker (draft, no-merge) | `main` | baseline empty commit `c848dee` | +0/−0 | type:feature |
| 7 | `01-registry` | #6 | `a8c8d50` | 635/400 exception | type:feature |
| 8 | `02-routing` | #7 | `4a64375` | 487/400 exception | type:feature |
| 9 | `03-docs-win` | #8 | `bb45b60`+`fa25642` | 78/400 in budget | type:docs |
| 10 | `04-composer` | #9 | `4e4d8b0`+`65390eb` | 538/400 exception | type:feature |
| 11 | `05-choices` | #10 | `2aebd6c` | 402/400 exception (+2) | type:feature |
| 12 | `06-fixes` | #11 | `bb3fede`+`31ef78f` | 146/400 in budget (RDD medium, under_budget) | type:feature |

Merge order (deepest first): #12 → #11 → #10 → #9 → #8 → #7 → tracker #6 → `main`.
Chain total (vs `main` `78e416b`, incl. tracker baseline): 31 files / +2004 −40.
Slice branches `feat/multi-provider-agents-0{1..5}-*` pushed to origin; tracker `feat/multi-provider-agents`
reset to `main` + baseline (content lives on the slice branches).
