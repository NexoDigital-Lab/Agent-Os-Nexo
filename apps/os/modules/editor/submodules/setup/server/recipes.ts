// The setup wizard's knowledge base: one recipe per stack — how to recognise it in a repo, what toolchains
// it needs, how to install its dependencies, how to scaffold it from scratch, its Run commands and extensions.
import { existsSync } from "node:fs";
import path from "node:path";
import { readJson } from "../../../../../host/server/http.ts";

export type Ctx = { repo: string; files: string[]; has: (f: string) => boolean; read: (f: string) => string };
export type Question = { id: string; label: string; type: "text" | "choice" | "bool"; default: string | boolean; options?: { value: string; label: string }[]; hint?: string };
export type Answers = Record<string, string | boolean>;

type Recipe = {
  id: string;
  name: string;
  desc: string;
  toolchains: string[]; // keys of runner's TOOLS
  detect: (c: Ctx) => string | null; // evidence, when an existing repo is this stack
  questions?: (project: string, ghUser: string) => Question[];
  scaffold?: (a: Answers, project: string) => { files: Record<string, string>; commands: string[]; gitignore?: string[] };
  deps?: (c: Ctx) => { label: string; cmd: string }[];
  run: { label: string; cmd: string }[];
  extensions: string[];
};

const pm = (c: Ctx) => (c.has("pnpm-lock.yaml") ? "pnpm" : c.has("yarn.lock") ? "yarn" : "npm");
const pkgDeps = (c: Ctx) => {
  const j = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null>(path.join(c.repo, "package.json"), null);
  return j ? { ...j.dependencies, ...j.devDependencies } : null;
};
const nodeDeps = (c: Ctx) => (c.has("package.json") && !existsSync(path.join(c.repo, "node_modules")) ? [{ label: "Install Node dependencies", cmd: `${pm(c)} install` }] : []);
// Generators refuse non-empty folders (README, .gitignore): scaffold into a temp dir and copy over without overwriting.
const generate = (cmd: string) => [`${cmd}`, "cp -rn _scaffold/. . && rm -rf _scaffold"];

export const RECIPES: Recipe[] = [
  {
    id: "go",
    name: "Go",
    desc: "Go module: a CLI or an HTTP server with net/http.",
    toolchains: ["go", "gopls"],
    detect: (c) => (c.has("go.mod") ? "go.mod" : c.files.some((f) => f.endsWith(".go")) ? ".go files" : null),
    questions: (p, gh) => [
      { id: "module", label: "Module name", type: "text", default: `github.com/${gh}/${p}`, hint: "Goes in go.mod; usually the repository URL" },
      { id: "kind", label: "What does it start?", type: "choice", default: "http", options: [{ value: "http", label: "HTTP server" }, { value: "cli", label: "Console program" }] },
    ],
    scaffold: (a) => ({
      commands: [`go mod init ${String(a.module).replace(/[^\w./-]/g, "")}`],
      files: {
        "main.go":
          a.kind === "cli"
            ? `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello from Go")\n}\n`
            : `package main\n\nimport (\n\t"fmt"\n\t"log"\n\t"net/http"\n)\n\nfunc main() {\n\thttp.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {\n\t\tfmt.Fprintln(w, "hello from Go")\n\t})\n\tlog.Println("listening on http://localhost:8080")\n\tlog.Fatal(http.ListenAndServe(":8080", nil))\n}\n`,
      },
      gitignore: ["/bin/", "*.exe"],
    }),
    deps: (c) => (c.has("go.mod") ? [{ label: "Download Go modules", cmd: "go mod download" }] : []),
    run: [{ label: "go run .", cmd: "go run ." }, { label: "go test ./...", cmd: "go test ./..." }],
    extensions: ["golang.go"],
  },
  {
    id: "nest",
    name: "NestJS",
    desc: "A Node API with NestJS (TypeScript).",
    toolchains: ["node"],
    detect: (c) => (pkgDeps(c)?.["@nestjs/core"] ? "@nestjs/core in package.json" : null),
    scaffold: () => ({ files: {}, commands: generate("npx -y @nestjs/cli@latest new _scaffold --skip-git --package-manager npm --strict") }),
    deps: nodeDeps,
    run: [{ label: "npm run start:dev", cmd: "npm run start:dev" }, { label: "npm test", cmd: "npm test" }],
    extensions: ["ashinzekene.nestjs", "dbaeumer.vscode-eslint", "humao.rest-client"],
  },
  {
    id: "next",
    name: "Next.js",
    desc: "A web app with Next.js (App Router, TypeScript).",
    toolchains: ["node"],
    detect: (c) => (pkgDeps(c)?.next ? "next in package.json" : null),
    questions: () => [{ id: "tailwind", label: "Tailwind CSS?", type: "bool", default: true }],
    scaffold: (a) => ({
      files: {},
      commands: generate(`npx -y create-next-app@latest _scaffold --ts --eslint --app --use-npm --import-alias "@/*" --disable-git --yes ${a.tailwind ? "--tailwind" : "--no-tailwind"}`),
    }),
    deps: nodeDeps,
    run: [{ label: "npm run dev", cmd: "npm run dev" }, { label: "npm run build", cmd: "npm run build" }],
    extensions: ["dsznajder.es7-react-js-snippets", "agent-os.next", "bradlc.vscode-tailwindcss", "dbaeumer.vscode-eslint"],
  },
  {
    id: "react-vite",
    name: "React + Vite",
    desc: "A SPA with React, TypeScript and Vite.",
    toolchains: ["node"],
    detect: (c) => {
      const d = pkgDeps(c);
      return d?.react && d?.vite ? "react + vite in package.json" : null;
    },
    scaffold: () => ({ files: {}, commands: [...generate("npm create -y vite@latest _scaffold -- --template react-ts"), "npm install"] }),
    deps: nodeDeps,
    run: [{ label: "npm run dev", cmd: "npm run dev" }, { label: "npm run build", cmd: "npm run build" }],
    extensions: ["dsznajder.es7-react-js-snippets", "dbaeumer.vscode-eslint"],
  },
  {
    id: "node-ts",
    name: "Node.js",
    desc: "A Node project without a framework; the template uses TypeScript + tsx.",
    toolchains: ["node"],
    detect: (c) => (c.has("package.json") && !pkgDeps(c)?.["@nestjs/core"] && !pkgDeps(c)?.next && !pkgDeps(c)?.react ? "package.json" : null),
    scaffold: () => ({
      files: { "src/index.ts": `console.log("hello from TypeScript");\n` },
      commands: [
        "npm init -y",
        "npm install -D typescript tsx @types/node",
        "npx tsc --init --rootDir src --outDir dist --module nodenext --target es2022",
        `npm pkg set scripts.dev="tsx watch src/index.ts" scripts.build="tsc" scripts.start="node dist/index.js"`,
      ],
      gitignore: ["node_modules/", "dist/"],
    }),
    deps: nodeDeps,
    run: [{ label: "npm run dev", cmd: "npm run dev" }, { label: "npm run build", cmd: "npm run build" }],
    extensions: ["yoavbls.pretty-ts-errors", "xabikos.JavaScriptSnippets"],
  },
  {
    id: "fastapi",
    name: "Python + FastAPI",
    desc: "A Python API with FastAPI, in a .venv virtual environment.",
    toolchains: ["python"],
    detect: (c) => (["requirements.txt", "pyproject.toml"].some((f) => c.has(f) && /fastapi/i.test(c.read(f))) ? "fastapi in the dependencies" : null),
    scaffold: () => ({
      files: {
        "requirements.txt": "fastapi\nuvicorn[standard]\n",
        "main.py": `from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get("/")\ndef root():\n    return {"hello": "from FastAPI"}\n`,
      },
      commands: ["python3 -m venv .venv", ".venv/bin/pip install -r requirements.txt"],
      gitignore: [".venv/", "__pycache__/"],
    }),
    deps: (c) => pyDeps(c),
    run: [{ label: "uvicorn --reload", cmd: ".venv/bin/uvicorn main:app --reload" }],
    extensions: ["ms-python.python", "ms-python.vscode-pylance", "charliermarsh.ruff", "humao.rest-client"],
  },
  {
    id: "python",
    name: "Python",
    desc: "A Python script or package with a .venv virtual environment.",
    toolchains: ["python"],
    detect: (c) => (c.has("requirements.txt") || c.has("pyproject.toml") ? "Python dependencies" : c.files.some((f) => f.endsWith(".py")) ? ".py files" : null),
    scaffold: () => ({
      files: { "main.py": `def main():\n    print("hello from Python")\n\n\nif __name__ == "__main__":\n    main()\n`, "requirements.txt": "" },
      commands: ["python3 -m venv .venv"],
      gitignore: [".venv/", "__pycache__/"],
    }),
    deps: (c) => pyDeps(c),
    run: [{ label: "python main.py", cmd: ".venv/bin/python main.py" }],
    extensions: ["ms-python.python", "ms-python.vscode-pylance", "charliermarsh.ruff"],
  },
  {
    id: "static",
    name: "HTML/CSS/JS",
    desc: "A static site without a build: index.html, style.css and script.js.",
    toolchains: [],
    detect: (c) => (!c.has("package.json") && c.files.some((f) => f.endsWith(".html")) ? "HTML without package.json" : null),
    scaffold: (_a, p) => ({
      files: {
        "index.html": `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>${p}</title>\n    <link rel="stylesheet" href="style.css" />\n  </head>\n  <body>\n    <h1>${p}</h1>\n    <script src="script.js"></script>\n  </body>\n</html>\n`,
        "style.css": `body {\n  font-family: system-ui, sans-serif;\n  margin: 2rem;\n}\n`,
        "script.js": `console.log("hello from JavaScript");\n`,
      },
      commands: [],
    }),
    run: [{ label: "local server :8000", cmd: "python3 -m http.server 8000" }],
    extensions: ["ritwickdey.LiveServer", "xabikos.JavaScriptSnippets"],
  },
];

function pyDeps(c: Ctx) {
  const venv = existsSync(path.join(c.repo, ".venv")) ? [] : [{ label: "Create the .venv virtual environment", cmd: "python3 -m venv .venv" }];
  if (c.has("requirements.txt")) return [...venv, { label: "Install requirements.txt", cmd: ".venv/bin/pip install -r requirements.txt" }];
  if (c.has("pyproject.toml")) return [...venv, { label: "Install the package (pyproject)", cmd: ".venv/bin/pip install -e ." }];
  return [];
}
