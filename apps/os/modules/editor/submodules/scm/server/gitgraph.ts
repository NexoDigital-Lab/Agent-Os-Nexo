// Git history for the per-tab graph (GitLens style): commits + refs, one commit's files, one file's diff.
import { httpError, run } from "../../../../../host/server/http.ts";

const MAX_DIFF = 400_000;
const HASH = /^[0-9a-f]{4,40}$/;

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

export type Ref = { name: string; kind: "head" | "local" | "remote" | "tag" };
export type Commit = { hash: string; parents: string[]; author: string; time: number; refs: Ref[]; subject: string };

/** `--decorate=full` names say what each ref is, so "feat/x" isn't mistaken for a remote. */
function parseRefs(d: string): Ref[] {
  if (!d) return [];
  return d.split(", ").flatMap((r): Ref[] => {
    if (r === "HEAD") return [{ name: "HEAD", kind: "head" }];
    if (r.startsWith("HEAD -> ")) return [{ name: r.slice(8).replace(/^refs\/heads\//, ""), kind: "head" }];
    if (r.startsWith("tag: ")) return [{ name: r.slice(5).replace(/^refs\/tags\//, ""), kind: "tag" }];
    if (r.startsWith("refs/heads/")) return [{ name: r.slice(11), kind: "local" }];
    if (r.startsWith("refs/remotes/")) return r.endsWith("/HEAD") ? [] : [{ name: r.slice(13), kind: "remote" }];
    return [];
  });
}

export async function graph(cwd: string, limit: number, all: boolean) {
  try {
    await git(cwd, "rev-parse", "--git-dir");
  } catch {
    throw httpError(400, "This tab is not in a git repository");
  }
  const n = String(Math.min(Math.max(limit, 50), 5000));
  // An empty repo has no HEAD yet — that's an empty graph, not an error.
  const log = await git(cwd, "log", ...(all ? ["--all"] : []), "--date-order", "--decorate=full", "-n", n,
    "--format=%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1e").catch(() => "");
  const commits: Commit[] = log
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, parents, author, at, refs, subject] = r.split("\x1f");
      return {
        hash,
        parents: parents ? parents.split(" ") : [],
        author,
        time: Number(at) * 1000,
        refs: parseRefs(refs),
        subject,
      };
    });
  const branch = (await git(cwd, "branch", "--show-current").catch(() => "")).trim();
  return { branch, commits };
}

function checkHash(h: string) {
  if (!HASH.test(h)) throw httpError(400, "Invalid hash");
}

/** Full message + changed files of one commit (against its first parent). */
export async function commitDetail(cwd: string, hash: string) {
  checkHash(hash);
  const [meta, stat] = await Promise.all([
    git(cwd, "show", "-s", "--format=%H%x1f%an%x1f%ae%x1f%at%x1f%B", hash),
    git(cwd, "show", "--format=", "--numstat", "--first-parent", "-m", hash),
  ]);
  const [full, author, email, at, body] = meta.split("\x1f");
  const files = stat
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [add, del, ...f] = l.split("\t");
      return { file: f.join("\t"), add: Number(add) || 0, del: Number(del) || 0, binary: add === "-" };
    });
  return { hash: full, author, email, time: Number(at) * 1000, body: body.trim(), files };
}

export async function commitFileDiff(cwd: string, hash: string, file: string) {
  checkHash(hash);
  const out = await git(cwd, "show", "--format=", "--first-parent", "-m", hash, "--", file);
  return { diff: out.length > MAX_DIFF ? out.slice(0, MAX_DIFF) + "\n… (diff truncado)" : out };
}

export type CommitDetail = Awaited<ReturnType<typeof commitDetail>>;
