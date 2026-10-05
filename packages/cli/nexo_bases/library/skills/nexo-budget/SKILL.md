---
name: nexo-budget
description: Size how heavy a nexo-dev run should be before gate 1 — risk signals, tier, which review agents, which model for each subagent — and offer the lighter or heavier option; after the run, record what it cost and what was worth it. Use from nexo-dev for M/L features, or standalone ("how heavy should this be?").
owner: nexo
version: 1.0.0
---

# nexo-budget

Subagents are the main cost of building with AI. This skill decides how many and which, for this feature,
and learns from each run so the next one is cheaper. Model limits come from `library/profile.json`
(`models.subagentDefault`, `models.subagentCeiling`): never go above the ceiling unless the user asks for
it in this conversation.

## 1. Signals

Read the feature, the plan's file list and the project's `context/` (its risk notes, if any). A signal
fires on a matching path or wording, each with its evidence (`file:line` or the plan line):

| Signal | Fires on | Risk |
|---|---|---|
| `auth` | login, session, token, password, permission, role | yes |
| `tenant-scope` | tenant/workspace/account filters, cross-account data | yes |
| `payment` | billing, credits, invoices, checkout, refunds | yes |
| `migration` | schema change, new table/column, data backfill | yes |
| `secrets` | API keys, encryption, env vars holding secrets | yes |
| `external-api` | third-party calls, webhooks, OAuth | — |
| `frontend-ui` | new screen, component, navigation, styling | — |
| `infra-deploy` | Dockerfile, CI, deploy config | — |
| `perf-critical` | hot paths, N+1, large loops, caching | — |

No signal is a normal result.

## 2. Proposal

- **Tier** — S: ≤2 files per task, spec complete, no risk → `subagentDefault` implementers (or inline).
  M: multi-file, 0–1 risk signal → the ceiling for implementers. L: design judgment or ≥2 risk signals →
  the ceiling, and a full review.
- **Review at the end** (`library/agents/`):
  - 0–1 signal → `code-reviewer` (correctness) + `simplifier` (size).
  - one risk signal → those + `security-reviewer` for auth/tenant/payment/secrets, or a deeper
    `code-reviewer` pass on the migration.
  - ≥2 risk signals → `code-reviewer` + `security-reviewer` + `simplifier` + `critic` (code mode).
  - Any critical finding from the light review → run the full set on that part, once.
- **Before planning** an L feature, or anything ambiguous: `challenger` on the request.
- **Routing table** — state it, nexo-dev uses it on every dispatch:
  ```
  implementer   S → subagentDefault | M, L → ceiling
  per-task check → subagentDefault (mechanical) | ceiling (subtle logic)
  final review  → ceiling (simplifier → subagentDefault)
  stuck fix (3rd try) → one step up, never above the ceiling
  ```

## 3. The choice — at gate 1

Offer, as options the user picks from:
1. **Recommended** — tier · review set · ~N subagents, with the signals that drove it.
2. **Lighter** — one reviewer, cheap models where possible, review only at the end.
3. **Heavier** — the full review set after every task.
4. **Manual** — ask tier, reviewers and models one by one.

## 4. After the run — learn

Append one line to `context/pipeline/runs.md` in the project:
`<date> · <feature> · tier <S|M|L> · <choice> · <N> subagents · worth it: yes/partly/no — <why>`.

Update `context/pipeline/reviewers.json`: a reviewer that found nothing critical three runs in a row on this
project becomes **quiet** (runs only when a signal maps to it); one that finds something becomes active
again. After five runs since the last calibration, suggest reviewing these thresholds — never change them
unprompted.

## Does not

- Pick models above the ceiling, or choose for the user at gate 1.
- Skip the security review when an auth, tenant, payment or secrets signal fired.
