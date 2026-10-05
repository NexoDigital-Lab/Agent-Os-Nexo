// The editor's client for its own routes and its submodules' (terminal, lsp, scm, practice, setup).
import { call } from "@os/lib/http";
import type { FileEntry } from "../server/files.ts";
import type { IconManifest } from "../server/icons.ts";
import type { RunCmd, ToolStatus } from "../server/runner.ts";
import type { SearchHit, SearchOpts } from "../server/search.ts";
import type { TermInfo } from "../submodules/terminal/server/terminal.ts";
import type { Branch, ScmStatus } from "../submodules/scm/server/scm.ts";
import type { Commit, CommitDetail } from "../submodules/scm/server/gitgraph.ts";
import type { Plan, Review } from "../submodules/practice/server/practice.ts";
import type { SetupAnalysis, SetupBody, SetupPlan } from "../submodules/setup/server/setup.ts";
export type { FileEntry, IconManifest, RunCmd, ToolStatus, SearchHit, SearchOpts, TermInfo, Branch, ScmStatus, Commit, CommitDetail, Plan, Review, SetupAnalysis, SetupBody, SetupPlan };
export type { Change } from "../submodules/scm/server/scm.ts";
export type { Ref } from "../submodules/scm/server/gitgraph.ts";
export type { Step } from "../submodules/practice/server/practice.ts";
export type { Question as SetupQuestion } from "../submodules/setup/server/recipes.ts";
export type { EditorPlugin } from "../../extensions/server/catalog.ts";
export type { Tab } from "../../sessions/web/api";

export const editorApi = {
  files: (id: string) => call<FileEntry[]>("GET", `/api/tabs/${id}/files`),
  readFile: (id: string, path: string) => call<{ exists: boolean; content: string }>("GET", `/api/tabs/${id}/file?path=${encodeURIComponent(path)}`),
  writeFile: (id: string, path: string, content: string) => call("PUT", `/api/tabs/${id}/file`, { path, content }),
  moveFile: (id: string, from: string, toDir: string) => call<{ path: string }>("POST", `/api/tabs/${id}/move`, { from, toDir }),
  createEntry: (id: string, path: string, kind: "file" | "dir") => call<{ path: string }>("POST", `/api/tabs/${id}/fs`, { op: kind, path }),
  renameEntry: (id: string, path: string, name: string) => call<{ path: string }>("POST", `/api/tabs/${id}/fs`, { op: "rename", path, name }),
  deleteEntry: (id: string, path: string) => call<{ trashed: boolean }>("POST", `/api/tabs/${id}/fs`, { op: "delete", path }),
  openEditor: (id: string, path?: string, line?: number) => call("POST", `/api/tabs/${id}/open-editor`, { path, line }),
  search: (id: string, o: SearchOpts) =>
    call<{ hits: SearchHit[]; truncated: boolean }>("GET", `/api/tabs/${id}/search?q=${encodeURIComponent(o.q)}&regex=${o.regex ? 1 : 0}&case=${o.matchCase ? 1 : 0}&word=${o.word ? 1 : 0}`),
  replace: (id: string, body: SearchOpts & { replacement: string; files: string[] }) =>
    call<{ changed: { path: string; count: number }[]; total: number }>("POST", `/api/tabs/${id}/replace`, body),
  runConfigs: (id: string) => call<RunCmd[]>("GET", `/api/tabs/${id}/run`),
  saveRun: (id: string, commands: { label: string; cmd: string }[]) => call("PUT", `/api/tabs/${id}/run`, { commands }),
  toolchains: (id: string) => call<ToolStatus[]>("GET", `/api/tabs/${id}/toolchains`),
  iconManifest: () => call<IconManifest>("GET", "/api/icons/manifest"),
  projectPlugins: (project: string) => call<{ editor: string[] }>("GET", `/api/projects/${encodeURIComponent(project)}/extensions`),
  // terminal
  terms: (id: string) => call<TermInfo[]>("GET", `/api/tabs/${id}/terms`),
  newTerm: (id: string, body: { title?: string; run?: string; where?: "host" | "container" } = {}) => call<TermInfo>("POST", `/api/tabs/${id}/terms`, body),
  killTerm: (id: string, tid: string) => call("DELETE", `/api/tabs/${id}/terms/${tid}`),
  termInput: (id: string, tid: string, data: string) => call("POST", `/api/tabs/${id}/terms/${tid}/input`, { data }),
  // lsp
  lspStatus: (lang: string) => call<{ lang: string; available: boolean; name: string | null; hint: string | null }>("GET", `/api/lsp/${lang}/status`),
  // scm
  scm: (id: string) => call<ScmStatus>("GET", `/api/tabs/${id}/scm`),
  scmStage: (id: string, paths: string[] | "all") => call<ScmStatus>("POST", `/api/tabs/${id}/scm/stage`, { paths }),
  scmUnstage: (id: string, paths: string[] | "all") => call<ScmStatus>("POST", `/api/tabs/${id}/scm/unstage`, { paths }),
  scmDiscard: (id: string, paths: string[]) => call<ScmStatus>("POST", `/api/tabs/${id}/scm/discard`, { paths }),
  scmCommit: (id: string, body: { message: string; amend?: boolean; all?: boolean }) => call<ScmStatus>("POST", `/api/tabs/${id}/scm/commit`, body),
  scmSync: (id: string, op: "push" | "pull" | "fetch") => call<ScmStatus>("POST", `/api/tabs/${id}/scm/sync/${op}`),
  scmBranches: (id: string) => call<Branch[]>("GET", `/api/tabs/${id}/scm/branches`),
  scmCheckout: (id: string, name: string, create = false) => call<ScmStatus>("POST", `/api/tabs/${id}/scm/checkout`, { name, create }),
  scmStash: (id: string, body: { op: "push" | "pop" | "apply" | "drop"; index?: number; message?: string }) => call<ScmStatus>("POST", `/api/tabs/${id}/scm/stash`, body),
  scmDiff: (id: string, path: string, staged: boolean) => call<{ original: string; modified: string }>("GET", `/api/tabs/${id}/scm/diff?path=${encodeURIComponent(path)}&staged=${staged ? 1 : 0}`),
  scmResolve: (id: string, path: string, side: "ours" | "theirs" | "manual") => call<ScmStatus>("POST", `/api/tabs/${id}/scm/resolve`, { path, side }),
  scmAbortMerge: (id: string) => call<ScmStatus>("POST", `/api/tabs/${id}/scm/abort-merge`),
  gitGraph: (id: string, all = true, limit = 400) => call<{ branch: string; commits: Commit[] }>("GET", `/api/tabs/${id}/git/graph?all=${all ? 1 : 0}&limit=${limit}`),
  gitCommit: (id: string, hash: string) => call<CommitDetail>("GET", `/api/tabs/${id}/git/commit/${hash}`),
  gitDiff: (id: string, hash: string, file: string) => call<{ diff: string }>("GET", `/api/tabs/${id}/git/diff?hash=${hash}&file=${encodeURIComponent(file)}`),
  // practice
  practice: (id: string) => call<{ plan: Plan | null; review: Review | null }>("GET", `/api/tabs/${id}/practice`),
  practicePlan: (id: string, task: string) => call<Plan>("POST", `/api/tabs/${id}/practice/plan`, { task }),
  practiceSnippet: (id: string, stepId: string) => call<{ text: string; cost: number }>("POST", `/api/tabs/${id}/practice/snippet`, { stepId }),
  practiceValidate: (id: string) => call<Review>("POST", `/api/tabs/${id}/practice/validate`),
  // setup
  setupAnalyze: (id: string) => call<SetupAnalysis>("GET", `/api/tabs/${id}/setup`),
  setupPlan: (id: string, body: SetupBody) => call<SetupPlan>("POST", `/api/tabs/${id}/setup/plan`, body),
  setupApply: (id: string, body: SetupBody) => call<SetupPlan & { chain: string | null }>("POST", `/api/tabs/${id}/setup/apply`, body),
};
