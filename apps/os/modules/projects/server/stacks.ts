// What a repo is built with, from its manifests (package.json, go.mod, pyproject…). Feeds extension
// recommendations, the editor's toolchains and Run commands, and the setup assistant.
import { readFileSync } from "node:fs";
import path from "node:path";
import { repoFiles } from "./repo.ts";

export type Stack = { key: string; evidence: string };

export async function detectStacks(repo: string): Promise<Stack[]> {
  const files = await repoFiles(repo);
  const found = new Map<string, string>();
  const add = (key: string, evidence: string) => !found.has(key) && found.set(key, evidence);
  const shallow = files.filter((f) => f.split("/").length <= 3); // root, apps/x/…, packages/x/…
  const base = (f: string) => f.split("/").pop()!;

  const pkgs = shallow.filter((f) => base(f) === "package.json");
  const DEPS: [string, RegExp][] = [
    ["next", /^next$/], ["react", /^react$/], ["nest", /^@nestjs\/core$/], ["tailwind", /^tailwindcss$/],
    ["prisma", /^(prisma|@prisma\/client)$/], ["mongodb", /^(mongoose|mongodb)$/], ["react-native", /^react-native$/],
    ["expo", /^expo$/], ["astro", /^astro$/], ["vue", /^vue$/], ["eslint", /^eslint$/], ["typescript", /^typescript$/],
    ["api", /^(express|fastify|koa|hono|@nestjs\/core)$/],
  ];
  let anyTs = false;
  for (const f of pkgs) {
    let deps: string[] = [];
    try {
      const j = JSON.parse(readFileSync(path.join(repo, f), "utf8"));
      deps = Object.keys({ ...j.dependencies, ...j.devDependencies });
    } catch {
      continue;
    }
    for (const [key, re] of DEPS) {
      const d = deps.find((x) => re.test(x));
      if (d) add(key, `${d} in ${f}`);
    }
    if (deps.includes("typescript")) anyTs = true;
  }
  if (pkgs.length && !anyTs && !shallow.some((f) => base(f) === "tsconfig.json")) add("javascript", `${pkgs[0]} without TypeScript`);
  if (shallow.some((f) => base(f) === "tsconfig.json")) add("typescript", "tsconfig.json");

  const gomod = shallow.find((f) => base(f) === "go.mod");
  if (gomod) {
    add("go", gomod);
    add("api", `${gomod} (Go backend)`);
  } else if (files.some((f) => f.endsWith(".go"))) add("go", ".go files");

  for (const f of shallow.filter((f) => ["pyproject.toml", "requirements.txt", "Pipfile"].includes(base(f)))) {
    add("python", f);
    const txt = readFileSync(path.join(repo, f), "utf8").toLowerCase();
    if (txt.includes("fastapi")) (add("api", `fastapi in ${f}`), add("fastapi", f));
    if (txt.includes("django")) (add("django", `django in ${f}`), add("api", `django in ${f}`));
  }
  if (!found.has("python") && files.some((f) => f.endsWith(".py"))) add("python", ".py files");

  const docker = shallow.find((f) => base(f) === "Dockerfile" || /^(docker-)?compose.*\.ya?ml$/.test(base(f)));
  if (docker) add("docker", docker);
  const yml = shallow.find((f) => /\.ya?ml$/.test(f));
  if (yml) add("yaml", yml);
  const env = shallow.find((f) => base(f).startsWith(".env"));
  if (env) add("dotenv", env);
  if (!pkgs.length && files.some((f) => f.endsWith(".html"))) {
    add("static", "HTML without package.json");
    if (files.some((f) => f.endsWith(".js"))) add("javascript", "loose .js files");
  }
  return [...found].map(([key, evidence]) => ({ key, evidence }));
}
