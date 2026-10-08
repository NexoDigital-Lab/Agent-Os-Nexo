# SSH in agent-os-nexo — design contract (server ↔ web). Types: modules/ssh/server/types.ts (do not change shapes without
updating both sides; adding optional fields is fine).

## Goals (from the user, verbatim intent)
- Save SSH accesses; open an SSH console as a **session tab**: chat on the left, the SSH console in the side panel
  (where Agents / Changes / Commits live today).
- The agent must NEVER see or touch credentials. The user flips a button to let the agent look at the console
  ("The agent sees the console" on/off). Off = the agent sees nothing.
- When shared: the agent may **read** freely (console output + read-only commands, no sensitive data). Anything else:
  the agent proposes **one clear plan**; the user approves it once (not per command).
- If a password is needed (sudo…), the agent asks in chat; the user types it **in the console**; the agent never sees it.

## Storage (server/vault.ts)
- File `<environment>/os/data/ssh/vault/vault.json` (temp key files in `.state/os/ssh/run`) (dir 0700, file 0600):
  `{ v: 1, kdf: "scrypt", N: 2**17, r: 8, p: 1, salt, iv, tag, ct }` (base64), AES-256-GCM over JSON
  `{ hosts: Array<SshHost-without-hasSecret & { secret?: string; passphrase?: string }> }`.
  scrypt maxmem must be raised (128*N*r*2). Every save uses a fresh iv. Atomic write (tmp + rename).
- Master password set once (setup), required after every server start (unlock). Held only in server memory
  (derived key). No recovery: say so in the UI. Wrong password → 401 "Wrong password" (GCM auth fails).
- `lock()` wipes the key + hosts from memory, drops all UI tokens, closes nothing else (sessions stay up).

## UI auth (the key idea: the agent's Bash can curl the API, so the API must not trust "localhost")
- `POST /api/ssh/setup {password}` (only when state=setup, min 12 chars) and `POST /api/ssh/unlock {password}` set
  an HttpOnly, SameSite=Strict, Path=/api/ssh cookie `agos_ssh=<random 32B hex>` (token kept in a Set in memory).
- EVERY other /api/ssh route and the console WebSocket require a valid cookie → 401 `{ error: "The SSH vault is
  bloqueada", locked: true }`. Only `GET /api/ssh/state` → `{ state: VaultState }` is public.
- The agent never gets the cookie (it can't unlock: it doesn't know the master password).
- guardRequest (util.ts) already enforces Host/Origin; keep it.

## Routes (server/index.ts, all JSON, English errors the UI translates)
- GET  /api/ssh/state                         → { state }
- POST /api/ssh/setup | /unlock | /lock
- GET  /api/ssh/hosts                         → SshHost[]
- POST /api/ssh/hosts  (SshHostInput)         → SshHost      (validate: name 1–60, host [A-Za-z0-9.-:] no leading -,
- PUT  /api/ssh/hosts/:id (SshHostInput)      → SshHost       port 1–65535, user [A-Za-z0-9._-] no leading -,
- DELETE /api/ssh/hosts/:id                   → { ok }         auth in SshAuth, project null or existing project)
- POST /api/ssh/hosts/:id/open                → { tabId }  creates a chat tab bound to the host (agent.openTab with
       project = host.project ?? "ssh", cwd = that project's repo or os.homedir(), title `ssh · <name>`) and connects.
- GET  /api/ssh/sessions/:tabId               → SshSessionInfo | 404
- POST /api/ssh/sessions/:tabId/connect       → SshSessionInfo   (reconnect; closes the old pty)
- POST /api/ssh/sessions/:tabId/share {shared:boolean} → SshSessionInfo
- POST /api/ssh/plans/:planId {approve:boolean} → { ok }
- WS   /api/ssh/term/:tabId   (cookie + sameOrigin) — same message protocol as tab terminals: server→client raw
       text; client→server JSON {type:"input",data} | {type:"resize",cols,rows}. Replays scrollback on attach.

## Sessions (server/session.ts) — one pty per SSH tab, Map<tabId, …>
- Spawn `ssh` in a node-pty: `-p port -o ServerAliveInterval=30 -o ServerAliveCountMax=3 user@host`.
  key: write the private key to a 0600 file in a fresh 0700 dir under `.state/os/ssh/run/`, pass
  `-i <file> -o IdentitiesOnly=yes`, delete the dir as soon as auth is done (first remote output after the
  prompts) or after 20 s or on exit — whichever first. password: `-o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no`.
  local: plain ssh with the user's env (agent, ~/.ssh).
  For password/key modes drop SSH_AUTH_SOCK from the child env.
- Auto-answer ONCE each, only while connecting and during the first 30 s, and only ssh's own prompt forms (whole line):
  `<user>@<host>'s password: ` or `(<user>@<host>) Password: ` → stored password; `Enter passphrase for key '<temp key
  path>': ` → stored passphrase. Never log them; they are not echoed by ssh. Host-key questions are left to the user.
  Extra ssh args: `-o ControlMaster=no -o ControlPath=none`.
- State: connecting → connected (the LocalCommand marker; no timing fallback) → closed (pty exit). Scrollback 256 KB.
- Tab closed (agent closeTab) → kill its ssh session.

## The agent side (server/tools.ts, wired through contributeToSessions in server/index.ts)
- In-process MCP server (`createSdkMcpServer`, name "ssh") attached to the query ONLY for tabs bound to a host.
  Tools (zod schemas, Spanish tool descriptions are fine but keep them precise):
  - `ssh_status` → host name (no address/user needed), state, shared, busy.
  - `ssh_read({ lines?: 1–400 = 120 })` → last N lines of the console, ANSI-stripped, REDACTED.
  - `ssh_run({ command, timeoutSec?: 1–300 = 30 })` → runs in the console (the user sees it) and returns
    { exitCode | null, output (redacted, ≤ 20k chars), status: "done" | "timeout" | "waiting_password" }.
    Allowed only if (a) policy.isReadOnly(command) or (b) it is a not-yet-used step of an APPROVED plan of this tab
    (exact string match). Otherwise error: "That command changes things: make a plan with ssh_plan and wait for
    the approval." `waiting_password` = the tail shows a password prompt → tell the agent to ask the user to type it in
    the console and then call ssh_read.
  - `ssh_plan({ summary, steps: SshPlanStep[1–20] })` → emits a module event `ssh/plan` (pending, `waiting: true`) to the tab, then WAITS for the
    user (POST /api/ssh/plans/:id) — independent of the permission mode (bypass included). Returns approved/rejected.
  - All tools: if the console is not shared → error "The SSH console is not shared: ask the user to turn on
    'The agent sees the console'". If not connected → error saying so.
- Running a command: write ` export PAGER=cat GIT_PAGER=cat SYSTEMD_PAGER= MANPAGER=cat; <command>; printf '\n__agos_<nonce>_%s__\n' "$?"\r` (leading space keeps it out of
  bash history when HISTCONTROL=ignorespace) and capture until the marker; strip the echoed command line and the
  marker from the output. One command at a time (busy). The pager exports keep `git log`, `journalctl` or `systemctl status` from
  holding the console in `less` (they stay in that shell). A line ending in `>` or after `=` (mysql>, >>>,
  psql's db=#) is not a shell prompt: nothing is typed into a REPL.
- Plans travel as module events: `{ kind: "module", module: "ssh", type: "plan", id, waiting, data: SshPlan }`
  (emitted again with the final status — the chat shows the latest per id, through the "chat.events" slot).
- System prompt note for SSH tabs: what the tools do, the read/plan rules, never ask the user for credentials in
  chat (ask them to type passwords in the console), sensitive files are off-limits.

## Barriers for the agent in ALL agent-os-nexo sessions (agent.ts `hooks.PreToolUse`, works in bypass mode too)
- policy.blockedToolUse(toolName, input) → reason | null. Check ONLY: Bash `command`; file paths of
  Read/Edit/Write/NotebookEdit/MultiEdit (`file_path`, `notebook_path`), Grep/Glob (`path`, `pattern` for Glob).
  Block: the module's folders (`os/data/ssh`, `.state/os/ssh`, by name and by absolute path), `/api/ssh`, direct `ssh`/`scp`/`sftp`/`sshpass`/`ssh-add`/
  `ssh-agent`/`ssh-keygen -y` invocations in Bash (word-boundary, also after `;|&&` and `sudo`), private keys under
  `.ssh/` (`id_*` without `.pub`, `*.pem`, `*.key`), `/proc/<pid>/(mem|environ|maps)`, `gdb -p`, `strace -p`,
  `ptrace`. `git` (incl. over ssh) stays allowed. Return a clear Spanish reason.

## Policy (server/policy.ts — pure, unit-tested with node:test in test/policy.test.ts)
- isReadOnly(cmd): split on `|` (pipes allowed); reject `;`, `&&`, `||`, `>`, `>>`, `<(`, `$(`, backticks, `&`
  at end, newline. Every segment's program must be in an allowlist: ls, cat, head, tail, grep, egrep, rg, find
  (without -delete/-exec/-ok), du, df, free, uptime, ps, pgrep, whoami, id, hostname, pwd, uname, date, stat, wc,
  file, which, ss, netstat, ip (a|addr|r|route|link only), uptime, lsblk, journalctl (no --vacuum*/--rotate),
  systemctl (status|is-active|is-enabled|list-units|list-timers|show only), docker (ps|logs|images|inspect|stats
  --no-stream|version|info), `docker compose` (ps|logs), git (status|log|diff|show|branch|remote -v), sort, uniq, cut,
  awk (no system( / > ), sed (only with -n and no w/e commands), tr, nl, less→reject, top (only -bn1), nginx -t,
  env/printenv → REJECT (secrets). And no argument may touch sensitive paths: .env (any .env*), id_rsa/id_ed25519/
  id_ecdsa, *.pem, *.key, /etc/shadow, .pgpass, .netrc, credentials, secrets, .aws/, .docker/config.json,
  authorized_keys, .git-credentials, .npmrc, .pypirc.
- redact(text): private key blocks, `(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[=:]\s*\S+`,
  `Bearer \S+`, AWS AKIA[0-9A-Z]{16}, JWT `eyJ[\w-]+\.[\w-]+\.[\w-]+`, URLs with `user:pass@` → `[redactado]`.

## Web (web/…)
- Rail view "SSH" (lucide KeyRound): setup (master password ×2, ≥12 chars, warning "if you forget it, it
  cannot be recovered"), locked (unlock), unlocked: host list + form (password field / key textarea are write-only: when a
  secret exists show "saved · replace"), delete with ConfirmDelete, "Open session" → switches to the new tab,
  "Lock" button. A 401 with locked:true anywhere → show the unlock form inline.
- SSH tabs: the tab's meta carries `ssh: { hostId, hostName }`. The "tab.sideReplace" slot puts SshSide in the
  chat's side column: header (host name, state pill, Reconnect), a prominent toggle
  "The agent sees the console" (Eye/EyeOff; off by default; clearly colored when on), then the xterm console over
  WS /api/ssh/term/:tabId (editor/Terminal.tsx gets an optional `url` prop).
- ChatLog renders Ev `ssh_plan` as a card: summary, numbered steps (command in mono + why), Aprobar / Rechazar
  (POST /api/ssh/plans/:id), final status after decision.

## Hardening (server side)
- Shared = "from now on": turning sharing on records the scrollback offset; ssh_read / ssh_run only return text produced
  after it. Redaction runs over the whole window before it is cut to N lines.
- Plan approvals are single-use and expire at turn end, on unshare, on (re)connect and after 30 minutes. A step that
  timed out stays approved.
- ssh_plan / ssh_run reject commands with invisible/confusable characters. ssh_run sends Ctrl+U first and refuses unless
  the console's last line is an idle shell prompt. Run status adds "closed" (console ended mid-run).
