// sessions: AI session tabs (/api/tabs), recent sessions and resume (/api/history), skills (/api/skills) and
// full-text search over past sessions (/api/sessions/search).
import express, { type Request } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { h, httpError, ok } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { addProjectHooks } from "../../projects/server/hooks.ts";
import { projectDiff, projectDir, projectOfPath, projectPath, worktreePath } from "../../projects/server/projects.ts";
import * as agent from "./agent.ts";
import { parseSendBody } from "./sendBody.ts";
import { contributeToSessions } from "./contributions.ts";
import { osGuard } from "./guard.ts";
import { listSkills, readPrefs, recommendSkills, writePrefs, initSkills } from "./skills.ts";
import { sessionIndex, setSearchDb } from "./sessionsearch.ts";
import { deleteUpload, IMAGE_TYPES, saveUpload, setUploadsDir, uploadPath } from "./uploads.ts";
import { findTranscript, listSessions, transcriptEvents } from "./usage.ts";

/** The tab a `/api/tabs/:id/…` route is about: its repository (cwd), project folder (dir) and project id, or 404. */
export function tabOf(req: Request) {
  const id = String(req.params.id);
  const t = agent.tabContext(id);
  if (!t) throw httpError(404, "Unknown tab");
  return { id, cwd: t.cwd, dir: t.dir, project: t.project, worktree: t.worktree, meta: t.meta };
}

/** Where a resumed session's tab runs: its project when the folder is one, else the folder itself. */
function placeOf(cwd: string) {
  const project = projectOfPath(cwd);
  const dir = project && projectDir(project);
  if (project && dir) {
    const wt = /\/worktrees\/([^/]+)/.exec(cwd.slice(dir.length))?.[1] ?? null;
    return { project, dir, cwd: (wt && worktreePath(project, wt)) || projectPath(project) || dir, worktree: wt };
  }
  return { project: "", dir: cwd, cwd, worktree: null };
}

const register: ModuleServer = (ctx) => {
  setUploadsDir(join(ctx.stateDir, "uploads"));
  setSearchDb(join(ctx.stateDir, "search.db"));
  initSkills(ctx.env);
  agent.restoreTabs(agent.tabsFileName(ctx.dataDir));
  // Every agent session: no reaching agent-os's own API or private data (guard.ts).
  contributeToSessions({
    hooks: { PreToolUse: [osGuard({ ports: [...new Set([ctx.port, 4780, 4781, 47470])], dirs: [ctx.env.data, ctx.env.state] })] },
  });

  addProjectHooks({
    deleteFacts: (p) => {
      const tabs = agent.listTabs().filter((t) => t.project === p.id);
      return { openTabs: tabs.length, runningTabs: tabs.filter((t) => t.running).length };
    },
    beforeLocalDelete: (p) => {
      for (const t of agent.listTabs().filter((t) => t.project === p.id)) agent.closeTab(t.id);
    },
  });

  const api = ctx.api;
  api.get("/tabs", h(() => agent.listTabs()));
  api.post("/tabs", h((req) => {
    const project = String(req.body.project ?? "");
    const dir = projectDir(project);
    let cwd = projectPath(project);
    if (!dir || !cwd) throw httpError(404, `Unknown project or no code/ yet: ${project}`);
    let worktree: string | null = null;
    if (req.body.worktree) {
      worktree = String(req.body.worktree);
      cwd = worktreePath(project, worktree);
      if (!cwd) throw httpError(404, `Unknown worktree: ${worktree}`);
    }
    return { id: agent.openTab({ project, dir, cwd, worktree, title: String(req.body.title || project.split("/").pop()) }) };
  }));
  api.patch("/tabs/:id", h((req) => (agent.renameTab(String(req.params.id), String(req.body.title)), ok)));
  api.delete("/tabs/:id", h((req) => (agent.closeTab(String(req.params.id)), ok)));
  api.get("/tabs/:id/diff", h((req) => projectDiff(tabOf(req).cwd)));
  api.post("/tabs/:id/seen", h((req) => (agent.markSeen(String(req.params.id)), ok)));
  api.get("/tabs/:id/stream", h((req, res) => agent.subscribe(String(req.params.id), res)));
  api.post("/tabs/:id/send", h((req) => {
    agent.send(String(req.params.id), parseSendBody(req.body));
    return ok;
  }));
  api.post("/tabs/:id/permission", h((req) => ({ ok: agent.answerPermission(String(req.params.id), String(req.body.permId), !!req.body.allow, !!req.body.always) })));
  api.post("/tabs/:id/quick", h((req) => agent.quickPrompt(String(req.params.id), String(req.body.text ?? ""), req.body.target ? String(req.body.target) : undefined)));
  api.post("/tabs/:id/tasks/:taskId/stop", h(async (req) => (await agent.stopTask(String(req.params.id), String(req.params.taskId)), ok)));
  api.post("/tabs/:id/interrupt", h((req) => (agent.interrupt(String(req.params.id)), ok)));

  // Temporary images (raw body: the browser already downscaled them)
  api.post(
    "/tabs/:id/uploads",
    express.raw({ type: Object.keys(IMAGE_TYPES), limit: "12mb" }),
    h((req) => {
      const { id } = tabOf(req);
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(415, "Empty image or unsupported format");
      return saveUpload(id, req.body, String(req.headers["content-type"]));
    }),
  );
  api.get("/tabs/:id/uploads/:name", (req, res) => {
    const file = uploadPath(String(req.params.id), String(req.params.name));
    if (file) res.sendFile(file);
    else res.status(404).end();
  });
  api.delete("/tabs/:id/uploads/:name", h((req) => (deleteUpload(String(req.params.id), String(req.params.name)), ok)));

  // Recent sessions (terminal and agent-os), resumable in a tab with one click.
  api.get("/history", h((req) =>
    listSessions(30)
      .slice(0, Number(req.query.limit ?? 10))
      .map(({ id, title, project, cwd, source, start, end, active, total, agents }) => ({
        id, title, project, cwd, source, start, end, active, cost: total.cost, agents: agents.length, tabId: agent.tabForSession(id),
      })),
  ));
  api.post("/history/:id/resume", h((req) => {
    const sid = String(req.params.id);
    const open = agent.tabForSession(sid);
    if (open) return { id: open, reused: true };
    const file = findTranscript(sid);
    const s = file && listSessions(30).find((x) => x.id === sid);
    if (!file || !s) throw httpError(404, "Session not found");
    if (!s.cwd || !existsSync(s.cwd)) throw httpError(410, `The session's folder no longer exists: ${s.cwd}`);
    const place = placeOf(s.cwd);
    const id = agent.resumeTab({ ...place, title: s.title.slice(0, 60), sdkSessionId: sid, fork: s.active, history: transcriptEvents(file) as agent.Ev[] });
    return { id, reused: false, forked: s.active };
  }));

  // Skills
  api.get("/skills", h(() => listSkills()));
  api.put("/skills/prefs", h((req) => {
    writePrefs({ disabled: req.body.disabled ?? [], pinned: req.body.pinned ?? [] });
    return readPrefs();
  }));
  api.post("/skills/recommend", h((req) => recommendSkills(String(req.body.task ?? ""), req.body.project ?? null)));

  // Full-text search over past sessions
  api.get("/sessions/search", h((req) => {
    const q = String(req.query.q ?? "").slice(0, 200);
    const project = req.query.project ? String(req.query.project) : null;
    return sessionIndex().search(q, { project, limit: Number(req.query.limit ?? 20) || 20 });
  }));
  api.get("/sessions/:id/around", h((req) => {
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/.test(id)) throw httpError(400, "Invalid id");
    return sessionIndex().around(id, String(req.query.at ?? ""), Number(req.query.n ?? 2) || 2);
  }));
};

export default register;
