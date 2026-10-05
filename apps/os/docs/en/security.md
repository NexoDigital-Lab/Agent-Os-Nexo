---
title: Security
summary: The trust model: local server, origin checks, agents' limits, the SSH vault and console.
order: 7
---

# Security

agent-os runs AI agents with the user's own permissions, on the user's machine. The design keeps three
things out: other websites (they must not drive the local API), other programs on the machine (they must
not be mistaken for agent-os), and the agents themselves (they must not reach credentials or act on
servers without the user's approval).

## The server

- **Local only.** It listens on `127.0.0.1`, one port (4780 app, 4781 preview, 47470 desktop window).
- **Host and origin checks** (`guardRequest`, `host/server/http.ts`), on every request:
  - the `Host` header must be this server (blocks DNS rebinding: `evil.com` resolving to 127.0.0.1
    keeps its own Host);
  - anything that changes state must come from agent-os's own page or a client without an `Origin`
    (curl, the CLI) — a website the user visits cannot POST to the API.
- **WebSockets** (terminals, language servers, the SSH console) check `sameOrigin` before upgrading.
- Every response carries `X-Content-Type-Options: nosniff` (user files are never sniffed into HTML) and
  `X-Agent-OS: 1`, which the CLI and the desktop app check before trusting a port.
- **One broken module never stops the others** (`host/server/mount.ts`).

Rule for modules: R3 (validate every input, `safePath` for paths, argument lists for processes) and R9
in [module-rules.md](module-rules.md).

## Agents

- **Reads stay in the project.** A PreToolUse hook (`confineHook`, `modules/sessions/server/claude.ts`)
  lets a session's agent read only inside its working folders, not `~/.ssh`, secrets or other projects.
- **Permissions** come from the environment (`library/permissions.json`, overridable per project);
  tools that gate themselves (ssh) are the only ones auto-allowed.
- **Text an agent receives** from a console or the session index goes through `redact`
  (`host/server/redact.ts`): private keys, tokens, passwords and credentials in URLs are masked.

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

- `nexo os start|preview` trusts a pid file only when that process is an agent-os server (by its command
  line), and only reports "started" once the server answers like agent-os.
- `nexo os stop` stops the app only; the preview needs `--preview` — an agent cleaning up its preview
  cannot take down the agent-os it runs in.
- The desktop app only loads its port if `/api/os/info` answers with `X-Agent-OS: 1`, and its native
  permissions (notifications, zoom) are scoped to `http://127.0.0.1:47470`.

## Reporting a problem

Report security problems privately through the repository's GitHub *Security → Report a vulnerability*
(private vulnerability reporting), never in a public issue.
