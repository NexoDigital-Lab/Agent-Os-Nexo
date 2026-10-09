# Packages and releases

How Nexo reaches a user's machine: two npm packages and a desktop installer. Nothing is published to npm yet;
until it is, everything installs from a checkout of this repository (`--from`).

## The two npm packages

| Package | Folder | What ships | Built how |
|---|---|---|---|
| `@nexodigital/nexo` | `packages/cli/` | `dist/` (the CLI compiled to JavaScript), `nexo_bases/` (factory content), `LICENSE` | `prepack` runs `tsc -p tsconfig.build.json`; bin `nexo` → `dist/bin.js` |
| `@nexodigital/agent-os-nexo` | `apps/os/` | the TypeScript source as is: `host/`, `modules/`, `src/`, `schema/`, `docs/`, `scripts/` | nothing at pack time: `nexo os build` builds it on the user's machine |

`npm pack --dry-run` on 2026-10-08: the CLI is 76 files (76 kB packed); agent-os-nexo is 435 files (571 kB packed),
module tests included on purpose — `os/source` is the user's editable copy, and the tests check their changes.

Both need Node 22.18+ (`engines`). The CLI has zero runtime dependencies (rule 3 in `AGENTS.md`); agent-os-nexo's
dependencies are installed once per dependency set into `os/runtime/<hash>/` and shared by its builds.

## How the CLI gets agent-os-nexo

`nexo os install` (or `nexo init --os yes`) needs the agent-os-nexo source:

- `--from <dir>`: copies a checkout (`<repo>/apps/os`) — the only way until it is published;
- otherwise: `npm pack @nexodigital/agent-os-nexo` into a temp folder, unpacked into `os/source/`.

It then installs the runtime and builds `1.0.0`. Later releases arrive with `nexo os update [--from <dir>]`, which
merges the new release into the user's version (`os/source` is a git repository: `base` = Nexo's releases,
`main` = the user's version) and stops on real conflicts.

## What `nexo init` lets the user choose

Asked interactively, or given as flags (`--yes` takes every default):

| Question | Flag | Default |
|---|---|---|
| Where the environment lives | `[path]` | `~/environments` |
| Which AIs to enable | `--tools claude,codex,gemini,opencode` | the ones found on `PATH`, else `claude` |
| Permission preset | `--preset strict\|normal\|relaxed` | `normal` |
| Name and email for commits | `--name`, `--email` | from `git config` |
| Language agents answer in | `--language <code>` | `en` |
| Factory items (skills, agents, hooks, commands) | `--factory all\|core\|none` | `all` |
| Install agent-os-nexo now | `--os yes\|no` (`--from <dir>` for a checkout) | `no` |

Everything can change later: `nexo permissions …`, `nexo update --factory all`, `nexo os install`, and the AIs in
`environment.config.json` → `tools` followed by `nexo update`.

## Running the CLI from a checkout (developers)

Developing Nexo inside a Nexo environment means the environment's own `nexo` must not be the checkout you are
editing. `nexo self-update --from <checkout> [--ref main|<tag>] [--bin <launcher>]` installs one commit instead:

- it reads `packages/cli` at that commit straight from git, so uncommitted changes and other branches never travel;
- the copy goes to `os/runtime/cli/<version>-<commit>/`, is started once (`--version`) before it is used, and the
  last two older copies are kept for a manual rollback;
- the launcher (default `~/.local/bin/nexo`, `nexo.cmd` on Windows) runs that copy with the `node` on `PATH`; a
  launcher Nexo did not write (an npm global install, for instance) is never overwritten;
- the checkout, ref and launcher are remembered in `.state/nexo/cli.json`, so the next update is just
  `nexo self-update` after merging to `main`.

## The desktop app

Not on npm. `.github/workflows/release-desktop.yml` builds the installers (deb, rpm, AppImage, dmg, NSIS) for each
OS and CPU when a tag `desktop-v<version>` is pushed, and attaches them with their SHA-256 sums to a **draft**
GitHub release that a maintainer publishes after checking it. `nexo os desktop [<tag>]` downloads the installer for
the current machine and verifies its checksum.

## Publishing to npm (not done yet)

What is missing, in order:

1. **The `@nexodigital` npm organization** and an automation token with publish rights, stored as the repository
   secret `NPM_TOKEN`. The token never goes in the repository or in a local file someone could commit.
2. **A release workflow**: on a tag `v<version>`, run `npm run check`, then `npm publish --access public
   --provenance` for each package (the CLI's `prepack` builds `dist/`).
3. **Versions**: the CLI follows `0.x` until the team calls it stable; agent-os-nexo's package version is the
   release Nexo ships, while each user's builds count from their own `1.0.0` (`nexo os build`).
4. **A first release check**: `npx @nexodigital/nexo@<version> init <tmp> --yes --os yes` on Linux, macOS and
   Windows, the same flow the CI `install` job runs from the checkout today.

When this is done, update the status line in the root `README.md` and the `--from` notes above.
