---
title: Security
summary: The trust model: local server, origin checks, agents' limits, the SSH vault and console.
group: reference
order: 8
---

# Security

agent-os-nexo runs AI agents with the user's own permissions, on the user's machine. The design keeps three
things out: other websites (they must not drive the local API), other programs on the machine (they must
not be mistaken for agent-os-nexo), and the agents themselves (they must not reach credentials or act on
servers without the user's approval).

## The server

- **Local only.** It listens on `127.0.0.1`, one port (4780 app, 4781 preview, 47470 desktop window).
- **Host and origin checks** (`guardRequest`, `host/server/http.ts`), on every request:
  - the `Host` header must be this server (blocks DNS rebinding: `evil.com` resolving to 127.0.0.1
    keeps its own Host);
  - anything that changes state must come from agent-os-nexo's own page or a client without an `Origin`
    (curl, the CLI) — a website the user visits cannot POST to the API.
- **An access token per run** (`host/server/access.ts`): at startup the server writes a random token to
  `.state/os/token-<port>` (0600). The browser enters once with `?token=…` (`nexo os open`, or the link
  `nexo os start` prints; the desktop app does it by itself), which becomes an HttpOnly, SameSite=Strict
  cookie. Every `/api` call except the health check `/api/os/info`, and every WebSocket, needs it: no other
  program on the machine can drive agent-os-nexo, and agents can't read the token (the guard keeps them out of
  `.state/os`).
- **WebSockets** (terminals, language servers, the SSH console) check `sameOrigin` — origin, host and the
  access token — before upgrading.
- Every response carries `X-Content-Type-Options: nosniff` (user files are never sniffed into HTML) and
  `X-Agent-OS-Nexo: 1`, which the CLI and the desktop app check before trusting a port.
- **One broken module never stops the others** (`host/server/mount.ts`).

Rule for modules: R3 (validate every input, `safePath` for paths, argument lists for processes) and R9
in [module-rules.md](module-rules.md).

## Agents

- **Reads stay in the project.** A PreToolUse hook (`confineHook`, `modules/sessions/server/claude.ts`)
  lets a session's agent read only inside its working folders, not `~/.ssh`, secrets or other projects.
- **agent-os-nexo itself is off limits.** A second PreToolUse hook (`modules/sessions/server/guard.ts`) refuses
  tool calls that reach agent-os-nexo's own API (its ports on loopback) or its private data (`os/data`,
  `.state/os`, paths resolved against the agent's folder). Like the ssh guard it reads what a call says:
  it stops the direct path, not a determined obfuscation by an agent the user allowed to run anything.
- **Permissions** come from the environment (`library/permissions.json`, overridable per project);
  tools that gate themselves (ssh) are the only ones auto-allowed.
- **Text an agent receives** from a console or the session index goes through `redact`
  (`host/server/redact.ts`): private keys, tokens, passwords and credentials in URLs are masked.
- **Claude sessions only.** `confineHook` path confinement and the Claude permission prompts apply to
  Claude (SDK) sessions; a non-Claude provider runs its own CLI in the project directory with its own
  permission model — the app does not mediate its tools in this version. What the app does enforce:
  the composer's mode becomes the CLI's own (Codex: `--sandbox read-only` unless edits are accepted, never
  `danger-full-access`; OpenCode: `--auto` only on bypass; Gemini: `--approval-mode plan` in plan mode, `auto_edit`
  when edits are accepted, never `yolo`), Stop kills the CLI, the project's generated AI files (permissions,
  `.state/**` unreadable) apply because the CLI runs in the project folder, only CLIs enabled in the environment's
  `tools` run at all, and one-shot helpers (notes, extensions) always use the bundled SDK, read-only. The skill
  recommendation may run through the tab's CLI only when it has a documented read-only mode (Codex, Gemini) and
  only in the project's folder; otherwise it uses the SDK too.
- **Frameworks (third-party methods).** A framework is installed by the `nexo framework` CLI with the same care as
  anything else from outside: npm sources are exact versions with `--ignore-scripts`, a `path:` folder is never
  modified, and the files a framework lists must stay inside its own folder. It is added off and never touches
  `permissions.json`; the environment's rules always come first. Its **hooks** run commands on every tool call, so
  they stay off until the user has seen the exact commands and approved twice in Settings → Frameworks (the app
  refuses an approval whose commands no longer match what was shown). In a tab that uses a framework, a Claude
  turn loads it as a Claude Code plugin (`nexo framework plugin`, built under `.state/nexo/plugins/`, hooks only
  when approved) and appends its instructions after the environment's note, marked "Instructions of the <name>
  framework (third party)"; a CLI provider's turn gets the same text in front of the prompt, without its skills or
  MCP servers. Tools such as the permission prompts and `confineHook` apply to its tool calls as to any other.
- **Windows launchers.** An npm `.cmd` shim runs its script with node, never through `cmd.exe`, which would run
  `& | < > ^ % ! "` inside a prompt; a launcher that is not npm's is refused any argument with those characters.
- **Dev containers see only their project.** A project's mirror dev container mounts its repo and worktrees (each
  `.git` read-only) and nothing else of `projects/`: not the other projects, not any `secrets/` folder. So the
  agent's `ctr …` and a dependency's install script cannot read past the project either. Container names carry a
  tag of the environment, and a container whose `agent-os-nexo.repo` label names another repository is never
  replaced or removed. A container created before this rule still mounts all of `projects/`: the Terminal view
  flags it until it is recreated.
- **A project's stack.** `docker compose config` expands the project's `.env` into its output, so the server keeps
  only service names, images, ports and dependencies: no environment value reaches the browser, a log or an agent,
  and compose errors go through `redact`. Compose runs with only the docker-related variables of the server's
  environment, so a compose file cannot interpolate a provider key or token. Every compose call is an argv
  (`execFile`) with names and repo-relative files checked on save **and again before each use** (`context/docker.json`
  can be edited by hand or by an agent); `down` never takes `-v`. A `-p` whose containers were created from files
  outside the repo is refused (it would take over another project's containers and volumes). Starting asks for a
  confirmation, with the reasons, when the profile looks like production, the Docker context is another machine, or
  the resolved stack asks for more than its repo: `privileged`, host `pid`/`ipc`/`network_mode`, `cap_add`,
  devices, the Docker socket, or a host folder or build context outside the repo.

## SSH: the vault and the console

The full contract is `modules/ssh/CONTRACT.md`. In short:

- **Vault:** `os/data/ssh/vault/vault.json`, AES-256-GCM with a key derived by scrypt from a master
  password the user types after each start; folder 0700, file 0600; no recovery by design. Five wrong
  passwords in a row lock unlocking for 30 seconds.
- **API:** everything except reading the state, setting up and unlocking needs an HttpOnly,
  SameSite=Strict cookie that only the password forms hand out — an agent's Bash can call the API but
  never gets the cookie.
- **Console:** the SSH session runs in a pty owned by the server; saved passwords and key passphrases are
  typed into the prompts by the server, so neither the browser nor the agent ever sees them. Temporary
  key files live in `.state/os/ssh/run/` for seconds.
- **The agent and the console:** only while the user turns on "The agent sees the console", and only
  output produced after that. Read-only commands (a strict allow list, `server/policy.ts`) run freely;
  anything else needs one plan the user approves, valid for that turn, and each step runs once.
- **The guard** (PreToolUse, every session, any permission mode): no direct `ssh`/`scp`/`sftp`, no
  private keys, no other processes' memory or environment, no debuggers, and no access to the ssh
  module's folders (`os/data/ssh`, `.state/os/ssh`, by name or absolute path) or its API.

## The CLI and the desktop app

- `nexo os start|preview` trusts a pid file only when that process is an agent-os-nexo server (by its command
  line), and only reports "started" once the server answers like agent-os-nexo.
- `nexo os stop` stops the app only; the preview needs `--preview` — an agent cleaning up its preview
  cannot take down the agent-os-nexo it runs in.
- The desktop app only loads its port if `/api/os/info` answers with `X-Agent-OS-Nexo: 1`, and its native
  permissions (notifications, zoom) are scoped to `http://127.0.0.1:47470`.

## Known limits

- **The token is as safe as `.state/os`.** Programs running as the user can read the token file; agents
  are kept out of it by the guard, which reads what a tool call says.
- **The http module keeps its environments in clear text** in `os/data/http/`. Agents are kept away from
  `os/data`, but other programs running as the user can read it.
- **The agent's own `docker`.** The project's stack is gated in the app; an agent whose permissions let it run
  `docker` in Bash can still run compose (or `docker exec`) itself.

## Reporting a problem

Report security problems privately through the repository's GitHub *Security → Report a vulnerability*
(private vulnerability reporting), never in a public issue.
