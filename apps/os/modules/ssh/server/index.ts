// ssh: saved SSH accesses in an encrypted vault (/api/ssh/*), one console per session tab (WebSocket
// /api/ssh/term/:tabId), and what the tab's agent may do with it (the "ssh" MCP tools, gated by sharing + plan
// approval) plus the PreToolUse guard that keeps every agent away from the credentials.
// The agent's Bash can curl this API, so it never trusts "localhost": everything but GET /ssh/state needs the cookie
// only the master-password forms hand out.
import os from "node:os";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import type { Request, Response } from "express";
import { h, httpError, ok } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { projectDir, projectPath } from "../../projects/server/projects.ts";
import * as agent from "../../sessions/server/agent.ts";
import { contributeToSessions, type TabContext } from "../../sessions/server/contributions.ts";
import { guardDirs } from "./policy.ts";
import * as session from "./session.ts";
import { createSshServer, decidePlan, endTurn, forgetTab, guardHooks, sshNote } from "./tools.ts";
import type { SshAuth, SshHostInput } from "./types.ts";
import { initVault, vault } from "./vault.ts";

/** The saved access an SSH tab is bound to (tab meta "ssh"; the host's secrets stay in the vault). */
export type SshBinding = { hostId: string; hostName: string };
const bindingOf = (tab: TabContext | null): SshBinding | null => {
  const b = tab?.meta.ssh as SshBinding | undefined;
  return b && typeof b.hostId === "string" ? b : null;
};

const COOKIE = "nexo_ssh";
const cookieAttrs = "HttpOnly; SameSite=Strict; Path=/api/ssh";

/** The vault cookie of a request (HTTP or WebSocket upgrade), parsed by hand: no cookie-parser dependency. */
function cookieOf(req: IncomingMessage): string | undefined {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return undefined;
}

const authorized = (req: IncomingMessage) => vault.validToken(cookieOf(req));
const login = (res: Response) => res.setHeader("Set-Cookie", `${COOKIE}=${vault.issueToken()}; ${cookieAttrs}`);

const password = (v: unknown) => {
  if (typeof v !== "string" || !v) throw httpError(400, "Missing password");
  return v;
};

const HOST = /^[A-Za-z0-9.:-]{1,255}$/;
const USER = /^[A-Za-z0-9._-]{1,64}$/;

function parseHost(b: any): SshHostInput {
  const name = typeof b?.name === "string" ? b.name.trim() : "";
  if (name.length < 1 || name.length > 60) throw httpError(400, "The name must have between 1 and 60 characters");
  if (typeof b.host !== "string" || !HOST.test(b.host) || b.host.startsWith("-")) throw httpError(400, "Invalid host (only letters, numbers, . - :)");
  if (!Number.isInteger(b.port) || b.port < 1 || b.port > 65535) throw httpError(400, "Invalid port (1 to 65535)");
  if (typeof b.user !== "string" || !USER.test(b.user) || b.user.startsWith("-")) throw httpError(400, "Invalid user (only letters, numbers, . _ -)");
  if (!["password", "key", "local"].includes(b.auth)) throw httpError(400, "Invalid access type");
  if (b.project !== null && b.project !== undefined && (typeof b.project !== "string" || !projectDir(b.project))) throw httpError(400, `Unknown project: ${b.project}`);
  for (const f of ["secret", "passphrase"] as const)
    if (b[f] !== undefined && (typeof b[f] !== "string" || b[f].length > 20_000)) throw httpError(400, `Invalid ${f}`);
  return { name, host: b.host, port: b.port, user: b.user, auth: b.auth as SshAuth, project: b.project ?? null, secret: b.secret, passphrase: b.passphrase };
}

function connectTab(tabId: string) {
  const bound = bindingOf(agent.tabContext(tabId));
  if (!bound) throw httpError(404, "This tab has no SSH session");
  const host = vault.get(bound.hostId);
  if (!host) throw httpError(404, "The saved access no longer exists");
  return session.connect(tabId, host);
}

const register: ModuleServer = (ctx) => {
  const vaultDir = path.join(ctx.dataDir, "vault");
  const runDir = path.join(ctx.stateDir, "run");
  initVault(vaultDir, runDir);
  session.cleanRunDir();
  guardDirs([ctx.dataDir, ctx.stateDir]);
  session.attachSshConsole(ctx.server, ctx.port, authorized);

  // SSH tabs get the console tools and a note; every session gets the credential guard.
  contributeToSessions({
    hooks: guardHooks,
    promptNote: (tab) => {
      const b = bindingOf(tab);
      return b ? sshNote(b.hostName) : null;
    },
    mcpServers: (tab, io) => (bindingOf(tab) ? { ssh: createSshServer(tab.id, io.emit, io.signal) } : null),
    // The ssh tools gate themselves (sharing switch + plan approval): asking again would make the user approve twice.
    autoAllow: (tab, tool) => !!bindingOf(tab) && tool.startsWith("mcp__ssh__"),
    onTurnEnd: (tab) => endTurn(tab.id), // plan approvals are for the turn they were given in
    onClose: (tab) => {
      forgetTab(tab.id);
      session.kill(tab.id);
    },
  });

  const api = ctx.api;

  // Public: the UI asks which form to show before it has a cookie.
  api.get("/ssh/state", h(() => ({ state: vault.state() })));
  api.post("/ssh/setup", h(async (req, res) => {
    const pw = password(req.body?.password);
    if (pw.length < 12) throw httpError(400, "The master password must have at least 12 characters");
    await vault.setup(pw);
    login(res);
    return { state: vault.state() };
  }));
  api.post("/ssh/unlock", h(async (req, res) => {
    await vault.unlock(password(req.body?.password));
    login(res);
    return { state: vault.state() };
  }));

  api.use("/ssh", (req, res, next) => {
    if (authorized(req)) return next();
    // Not through httpError: the UI needs `locked` to show the unlock form.
    res.status(401).json({ error: "The SSH vault is locked", locked: true });
  });

  api.post("/ssh/lock", h((_req, res) => {
    vault.lock();
    res.setHeader("Set-Cookie", `${COOKIE}=; Max-Age=0; ${cookieAttrs}`);
    return { state: vault.state() };
  }));

  api.get("/ssh/hosts", h(() => vault.list()));
  api.post("/ssh/hosts", h((req) => vault.add(parseHost(req.body))));
  api.put("/ssh/hosts/:id", h((req) => {
    const updated = vault.update(String(req.params.id), parseHost(req.body));
    if (!updated) throw httpError(404, "Unknown host");
    return updated;
  }));
  api.delete("/ssh/hosts/:id", h((req) => {
    if (!vault.remove(String(req.params.id))) throw httpError(404, "Unknown host");
    return ok;
  }));

  // An SSH tab runs in its project when the access has one, else in the home folder (no project).
  api.post("/ssh/hosts/:id/open", h((req) => {
    const host = vault.get(String(req.params.id));
    if (!host) throw httpError(404, "Unknown host");
    const dir = (host.project && projectDir(host.project)) || null;
    const tabId = agent.openTab({
      project: dir ? host.project! : "",
      dir: dir ?? os.homedir(),
      cwd: (dir && projectPath(host.project!)) || dir || os.homedir(),
      title: `ssh · ${host.name}`,
      meta: { ssh: { hostId: host.id, hostName: host.name } satisfies SshBinding },
    });
    // connect() reports a failed launch as a closed console: no tab should be left behind for it.
    let failed = true;
    try {
      failed = session.connect(tabId, host).state === "closed";
    } finally {
      if (failed) agent.closeTab(tabId);
    }
    if (failed) throw httpError(500, "Could not open the SSH connection");
    return { tabId };
  }));

  // A bound tab whose pty is gone (server restarted) reports "closed" so the UI can offer Reconnect.
  api.get("/ssh/sessions/:tabId", h((req) => {
    const tabId = String(req.params.tabId);
    const live = session.status(tabId);
    if (live) return live;
    const bound = bindingOf(agent.tabContext(tabId));
    if (!bound) throw httpError(404, "This tab has no SSH session");
    return { tabId, hostId: bound.hostId, hostName: bound.hostName, state: "closed", shared: false, busy: false };
  }));
  api.post("/ssh/sessions/:tabId/connect", h((req) => connectTab(String(req.params.tabId))));
  api.post("/ssh/sessions/:tabId/share", h((req: Request) => {
    if (typeof req.body?.shared !== "boolean") throw httpError(400, "Missing shared (true or false)");
    const info = session.setShared(String(req.params.tabId), req.body.shared);
    if (!info) throw httpError(404, "There is no open SSH session in this tab");
    return info;
  }));

  api.post("/ssh/plans/:planId", h((req) => {
    if (typeof req.body?.approve !== "boolean") throw httpError(400, "Missing approve (true or false)");
    if (!decidePlan(String(req.params.planId), req.body.approve)) throw httpError(404, "That plan is no longer waiting");
    return ok;
  }));
};

export default register;
