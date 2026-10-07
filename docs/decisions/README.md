# Decisions

Design decisions taken before the first line of code (2026-10). Newest at the bottom; a change to
any of them gets a new entry here, never a silent edit.

| # | Area | Decision |
|---|---|---|
| 1 | Distribution | One npm package that installs the environment; the environment is the differentiator |
| 2 | Names | English, lowercase, kebab-case; plural for collections, singular for areas and files |
| 3 | Root markdown | Only `AGENTS.md`; per-AI hidden folders are generated pointers |
| 4 | Config | `environment.config.json` is lean: only what exists nowhere else |
| 5 | Factory vs user | Factory ships in `nexo_bases/`; `library/` starts empty and is never versioned by Nexo |
| 6 | Update policy | `nexo update` replaces only `owner: nexo` items |
| 7 | Projects | `<name>/` or `<name>-ws/<part>/`, each with `code/`, `context/`, `secrets/`; `context/` not versioned by default |
| 8 | Connections | `library/connections/`, credentials included; claude.ai connectors registered too |
| 9 | Permissions | allow / ask / deny; global + per project; presets strict / normal / relaxed; edited by the user, by the agent only after asking |
| 10 | Blueprints | Start empty, not versioned; agent proposes one after a feature, fixed creation conventions |
| 11 | Memory | `library/memory/`, filled by the agent; project memory goes to the project's `context/` |
| 12 | OS analysis | Recommended by `nexo doctor` when stale; never automatic |
| 13 | CLI | TypeScript, zero runtime dependencies |
| 14 | Factory language | English; agents answer in the user's language |
| 15 | Sizes | `SKILL.md` ≤ 200 lines, environment `AGENTS.md` ≤ 120 lines |
| 16 | Model ceiling | Configurable in `profile.json`; default haiku, max sonnet for subagents |
| 17 | Git | English commits, author from profile, no AI co-author trailer by default, push/PR ask, force push to main deny |
| 18 | agent-os-nexo | Modular (manifest per module, auto-detected, enable/disable); personal versions from `1.0.0`; major reserved to Nexo |
| 19 | SSH | Lives in agent-os-nexo's encrypted vault; agents never use it on their own |
