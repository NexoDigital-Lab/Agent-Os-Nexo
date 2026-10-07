// Recipes: every stack scaffolds something sensible and its questions/extensions/run commands are well formed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECIPES, type Ctx } from "../server/recipes.ts";

const recipe = (id: string) => RECIPES.find((r) => r.id === id)!;
const ctx = (files: Record<string, string>): Ctx => ({ repo: "/nowhere", files: Object.keys(files), has: (f) => f in files, read: (f) => files[f] ?? "" });

test("recipe ids are unique and each declares extensions and run commands", () => {
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length);
  for (const r of RECIPES) {
    assert.ok(r.name && r.desc, r.id);
    assert.ok(r.run.length > 0 && r.run.every((c) => c.label && c.cmd), r.id);
    assert.ok(r.extensions.every((e) => /^[\w-]+\.[\w.-]+$/.test(e)), r.id);
  }
});

test("Go scaffold: http server by default, console program on request, module name sanitised", () => {
  const go = recipe("go");
  const http = go.scaffold!({ module: "a/b c;rm", kind: "http" }, "p");
  assert.equal(http.commands[0], "go mod init a/bcrm");
  assert.match(http.files["main.go"], /ListenAndServe/);
  assert.match(go.scaffold!({ module: "m", kind: "cli" }, "p").files["main.go"], /fmt\.Println/);
  assert.deepEqual(go.questions!("proj", "me").map((q) => q.default), ["github.com/me/proj", "http"]);
});

test("generator-based scaffolds copy into a non-empty folder without overwriting", () => {
  for (const id of ["nest", "next", "react-vite"]) {
    const s = recipe(id).scaffold!({ tailwind: true }, "p");
    assert.deepEqual(s.files, {});
    assert.ok(s.commands.includes("cp -rn _scaffold/. . && rm -rf _scaffold"), id);
  }
  assert.match(recipe("next").scaffold!({ tailwind: true }, "p").commands[0], / --tailwind$/);
  assert.match(recipe("next").scaffold!({ tailwind: false }, "p").commands[0], / --no-tailwind$/);
  assert.equal(recipe("next").questions!("p", "u")[0].type, "bool");
  assert.equal(recipe("react-vite").scaffold!({}, "p").commands.at(-1), "npm install");
});

test("Node and Python scaffolds create their entry files and ignore build output", () => {
  const node = recipe("node-ts").scaffold!({}, "p");
  assert.ok(node.files["src/index.ts"]);
  assert.deepEqual(node.gitignore, ["node_modules/", "dist/"]);
  const fast = recipe("fastapi").scaffold!({}, "p");
  assert.match(fast.files["requirements.txt"], /fastapi/);
  assert.match(fast.files["main.py"], /FastAPI\(\)/);
  const py = recipe("python").scaffold!({}, "p");
  assert.equal(py.files["requirements.txt"], "");
  assert.deepEqual(py.commands, ["python3 -m venv .venv"]);
  assert.deepEqual(py.gitignore, [".venv/", "__pycache__/"]);
});

test("the static template names the page after the project", () => {
  const s = recipe("static").scaffold!({}, "My Site");
  assert.match(s.files["index.html"], /<title>My Site<\/title>/);
  assert.deepEqual(s.commands, []);
  assert.deepEqual(Object.keys(s.files), ["index.html", "style.css", "script.js"]);
});

test("Python dependency commands: requirements or pyproject, with the venv step (/nowhere has no .venv)", () => {
  const cmds = (id: string, files: Record<string, string>) => recipe(id).deps!(ctx(files)).map((d) => d.cmd);
  assert.deepEqual(cmds("python", { "requirements.txt": "" }), ["python3 -m venv .venv", ".venv/bin/pip install -r requirements.txt"]);
  assert.deepEqual(cmds("fastapi", { "pyproject.toml": "" }), ["python3 -m venv .venv", ".venv/bin/pip install -e ."]);
  assert.deepEqual(cmds("python", {}), []);
});

test("detection returns evidence text or null", () => {
  assert.equal(recipe("go").detect(ctx({ "go.mod": "" })), "go.mod");
  assert.equal(recipe("go").detect(ctx({ "x.go": "" })), ".go files");
  assert.equal(recipe("go").detect(ctx({})), null);
  assert.equal(recipe("static").detect(ctx({ "a.html": "" })), "HTML without package.json");
  assert.equal(recipe("python").detect(ctx({ "a.py": "" })), ".py files");
});
