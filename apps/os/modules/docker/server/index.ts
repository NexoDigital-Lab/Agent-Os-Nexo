// docker: containers, images, logs and shells (/api/docker/*), and each project's mirror dev container
// (/api/tabs/:id/devenv). The dev container plugs into terminals (shell provider), AI sessions (env + prompt note)
// and project deletion (offer to remove it).
import os from "node:os";
import path from "node:path";
import { h, httpError, ok } from "../../../host/server/http.ts";
import type { ModuleServer } from "../../../host/server/module-api.ts";
import { addProjectHooks } from "../../projects/server/hooks.ts";
import { projectPath } from "../../projects/server/projects.ts";
import { contributeToSessions } from "../../sessions/server/contributions.ts";
import { tabOf } from "../../sessions/server/index.ts";
import { addShellProvider, createTerm, killTerm, listTerms, shellFor } from "../../editor/submodules/terminal/server/terminal.ts";
import * as docker from "./docker.ts";
import * as devenv from "./devenv.ts";

const DOCKER_TAB = "docker"; // the Docker view's terminals live under this pseudo-tab

const repoOf = (project: string) => {
  const repo = projectPath(project);
  if (!repo) throw httpError(404, `Unknown project or no code/ yet: ${project}`);
  return repo;
};

const register: ModuleServer = (ctx) => {
  devenv.initDevenv(ctx.env.projects, path.join(ctx.stateDir, "shims"));

  // Terminals: the tab's bash gets the container's tools first on PATH; "container" opens a shell inside it.
  addShellProvider((project, where) => {
    if (!project || !devenv.hasDevEnv(project)) return undefined;
    return where === "container"
      ? { file: path.join(devenv.shimDir(project), "ctr"), args: [] }
      : { file: "bash", args: ["--rcfile", path.join(devenv.shimDir(project), "bashrc"), "-i"] };
  });

  // AI sessions: CLAUDE_ENV_FILE puts the shims first on PATH before every Bash command, plus a note on how to use them.
  contributeToSessions({
    env: (tab) => (tab.project && devenv.hasDevEnv(tab.project) ? { CLAUDE_ENV_FILE: devenv.envFile(tab.project) } : null),
    promptNote: (tab) => (tab.project ? devenv.promptNote(tab.project) : null),
  });

  // Deleting a project offers to remove its container too (off by default).
  addProjectHooks({
    deleteFacts: async (p) => ({
      container: p.path ? await devenv.status(p.id, p.path).then((s) => (s.state === "running" || s.state === "stopped" ? s.container : null), () => null) : null,
    }),
    afterLocalDelete: async (p, opts, steps) => {
      if (!opts.container) return;
      try {
        await devenv.remove(p.id);
        steps.push(`Container ${devenv.containerName(p.id)} and its shims removed`);
      } catch (e) {
        steps.push(`Container ${devenv.containerName(p.id)} not removed: ${(e as Error).message}`);
      }
    },
  });

  const api = ctx.api;
  api.get("/docker/info", h(() => docker.info()));
  api.post("/docker/desktop/open", h(async () => docker.openDockerDesktop()));
  api.get("/docker/containers", h(() => docker.containers()));
  api.get("/docker/images", h(() => docker.images()));
  api.post("/docker/containers/:id/:action", h(async (req) => {
    const action = String(req.params.action) as docker.ContainerAction;
    if (!["start", "stop", "restart", "rm"].includes(action)) throw httpError(400, `Unknown action: ${action}`);
    const id = String(req.params.id);
    // Removing a project's dev container from here must also drop its shims, or terminals would point at a ghost.
    const project = action === "rm" ? await docker.projectLabel(id) : null;
    await docker.containerAction(id, action);
    if (project) devenv.forgetShims(project);
    return ok;
  }));
  api.get("/docker/containers/:id/logs", h(async (req) => ({ text: await docker.logs(String(req.params.id)) })));
  api.delete("/docker/images/:id", h(async (req) => (await docker.removeImage(String(req.params.id)), ok)));
  api.post("/docker/pull", h(async (req) => ({ digest: await docker.pull(String(req.body?.image ?? "")) })));

  api.get("/docker/terms", h(() => listTerms(DOCKER_TAB)));
  api.post("/docker/terms", h((req) => {
    const c = String(req.body?.container ?? "");
    return createTerm(DOCKER_TAB, os.homedir(), c, undefined, { file: "docker", args: docker.execShellArgs(c) });
  }));
  api.delete("/docker/terms/:tid", h((req) => (killTerm(DOCKER_TAB, String(req.params.tid)), ok)));

  // The tab's project dev container
  api.get("/tabs/:id/devenv", h((req) => {
    const { project } = tabOf(req);
    return devenv.status(project, repoOf(project));
  }));
  api.post("/tabs/:id/devenv", h((req) => {
    const { project } = tabOf(req);
    const { lang, version, ports } = req.body ?? {};
    return devenv.create(project, repoOf(project), { lang, version: String(version ?? ""), ports: Array.isArray(ports) ? ports : [] });
  }));
  api.delete("/tabs/:id/devenv", h(async (req) => (await devenv.remove(tabOf(req).project), ok)));
  api.post("/tabs/:id/devenv/install", h(async (req) => {
    const { id, project, cwd } = tabOf(req);
    const { config } = await devenv.status(project, repoOf(project));
    if (!config) throw httpError(409, "This project has no dev container");
    const cmd = devenv.installCommand(cwd, config.lang);
    if (!cmd) throw httpError(404, "Nothing to install found (requirements.txt, pyproject.toml, package.json, go.mod)");
    return createTerm(id, cwd, "dependencies", `ctr sh -c '${cmd}'`, shellFor(project, "host"));
  }));
};

export default register;
