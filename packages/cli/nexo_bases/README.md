# nexo_bases

Factory content shipped in the npm package. `nexo init` places it in a new environment and
`nexo update` refreshes it.

| Path | Placed at | Updated by `nexo update` |
|---|---|---|
| `environment/AGENTS.md` | `<env>/AGENTS.md` | No — once created it is the user's |
| `library/skills/<name>/` | `<env>/library/skills/<name>/` | Yes, while `SKILL.md` says `owner: nexo` |
| `library/agents/<name>.md` | `<env>/library/agents/` | Yes, while `owner: nexo` |
| `library/hooks/<name>.json` + `scripts/` | `<env>/library/hooks/` | Yes, while `owner: nexo` |
| `library/commands/<name>.json` | `<env>/library/commands/` | Yes, while `owner: nexo` |
| `library/conventions/<topic>/README.md` | `<env>/library/conventions/<topic>/` | Yes, while `owner: nexo` |
| `library/profile.json` | `<env>/library/profile.json` | No — template filled at init |
| `permissions/<preset>.json` | `<env>/library/permissions.json` | No — the chosen preset, then the user's |
| `engram.json` | Not copied: the Engram release `nexo memory install\|update` downloads (version, SHA-256 per platform) | Raised by a Nexo release after CI ran the new binary |
| `project/` | `<env>/projects/<name>/` by `nexo clone` / `nexo new` | No |

Everything here is English and contains no personal data. Formats are validated by
`nexo doctor` (see the repository `AGENTS.md`).
