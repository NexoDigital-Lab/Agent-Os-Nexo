import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../src/core/frontmatter.ts";
import { compareVersions, nextVersion } from "../src/core/osversions.ts";
import { claudeBashRule, mergePermissions, toClaudePermissions, validatePermissions } from "../src/core/permissions.ts";
import { render } from "../src/core/fsx.ts";
import { repoName, validateName } from "../src/core/projects.ts";

test("frontmatter: scalars, quoted values and lists", () => {
  const { data, body, hasFrontmatter } = parseFrontmatter('---\nname: x\nowner: "nexo"\ntools: [read, grep]\n---\nbody\n');
  assert.equal(hasFrontmatter, true);
  assert.deepEqual(data, { name: "x", owner: "nexo", tools: ["read", "grep"] });
  assert.equal(body, "body\n");
  assert.equal(parseFrontmatter("no frontmatter").hasFrontmatter, false);
});

test("os versions: start at 1.0.0, roll the minor after .9, never touch the major", () => {
  assert.equal(nextVersion(null), "1.0.0");
  assert.equal(nextVersion("1.0.0"), "1.0.1");
  assert.equal(nextVersion("1.0.8"), "1.0.9");
  assert.equal(nextVersion("1.0.9"), "1.1.0");
  assert.equal(nextVersion("1.9.9"), "1.10.0");
  assert.equal(nextVersion("2.3.4"), "2.3.5");
  assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
});

test("permissions: Bash rules from command patterns", () => {
  assert.equal(claudeBashRule("git push*"), "Bash(git push:*)");
  assert.equal(claudeBashRule("docker *"), "Bash(docker:*)");
  assert.equal(claudeBashRule("npm test"), "Bash(npm test)");
});

test("permissions: translation to Claude uses absolute paths per decision", () => {
  const out = toClaudePermissions(
    { files: { read: { deny: ["projects/**/secrets/**"] }, edit: { ask: ["projects/**/code/**"] } }, commands: { allow: ["git status*"] } },
    "/env",
  );
  assert.deepEqual(out.deny, ["Read(//env/projects/**/secrets/**)"]);
  assert.deepEqual(out.ask, ["Edit(//env/projects/**/code/**)"]);
  assert.deepEqual(out.allow, ["Bash(git status:*)"]);
});

test("permissions: project rules extend global ones, project default wins", () => {
  const merged = mergePermissions(
    { default: "ask", commands: { allow: ["git status*"] } },
    { default: "deny", commands: { deny: ["psql *"] } },
  );
  assert.equal(merged.default, "deny");
  assert.deepEqual(merged.commands, { allow: ["git status*"], deny: ["psql *"] });
});

test("permissions: validation catches unknown decisions", () => {
  assert.deepEqual(validatePermissions({ default: "ask" }), []);
  assert.equal(validatePermissions({ os: { restart: "maybe" as never } }).length, 1);
  assert.equal(validatePermissions({ commands: { always: ["x"] } as never }).length, 1);
});

test("templates and names", () => {
  assert.equal(render("# {{name}} {{other}}", { name: "demo" }), "# demo {{other}}");
  assert.equal(repoName("git@github.com:Org/My-Repo.git"), "my-repo");
  assert.equal(repoName("https://github.com/org/app/"), "app");
  assert.throws(() => validateName("Bad Name"));
});

test("every published package carries the repository's LICENSE, unchanged", () => {
  const repo = join(import.meta.dirname, "..", "..", "..");
  const license = readFileSync(join(repo, "LICENSE"), "utf8").replace(/\r\n/g, "\n");
  for (const pkg of ["packages/cli", "apps/os", "apps/desktop"]) {
    const pkgLicense = readFileSync(join(repo, pkg, "LICENSE"), "utf8").replace(/\r\n/g, "\n");
    assert.equal(pkgLicense, license, `${pkg}/LICENSE differs: copy the root LICENSE again`);
  }
});

test("symbolsOf finds top-level symbols in each language, not calls or locals", async () => {
  const { symbolsOf } = await import("../src/core/symbols.ts");
  const names = (text: string, ext: string) => symbolsOf(text, ext).map((s) => `${s.kind} ${s.name}`);
  assert.deepEqual(names("export async function load() {}\nconst x = 1;\nexport class Store {}\nexport type Id = string;\nexport const api = {};\nif (x) call();\n", ".ts"),
    ["function load", "class Store", "type Id", "const api"]);
  assert.deepEqual(names("class Repo:\n    def get(self):\n        pass\ndef main():\n    print('x')\n", ".py"), ["class Repo", "method get", "function main"]);
  assert.deepEqual(names("func (s *Server) Start() error {\nfunc main() {\ntype Config struct {\n", ".go"), ["method Start", "function main", "type Config"]);
  assert.deepEqual(names("pub struct App;\nimpl App {\n    pub async fn run(&self) {}\n}\n", ".rs"), ["type App", "impl App", "function run"]);
  assert.deepEqual(symbolsOf("function f() {}", ".md"), []);
});

test("the index finds routes per framework, with router prefixes, and matches calls to them", async () => {
  const { findRoutes, findCalls, matchCall, callPath, isTest, composeServices } = await import("../src/core/projectIndex.ts");
  const src = (rel: string, text: string, part = "p") => ({ rel, part, ext: rel.slice(rel.lastIndexOf(".")), text });
  const routes = findRoutes([
    src("api/users.py", 'router = APIRouter(prefix="/users")\n@router.get("/{user_id}")\ndef get(): ...\n'),
    src("api/users.controller.ts", "@Controller('orders')\nclass C {\n  @Get(':id')\n  one() {}\n  @Post()\n  make() {}\n}\n"),
    src("web/app/api/items/[id]/route.ts", "export async function GET() {}\nexport const POST = h;\n"),
    src("srv/main.go", 'r.GET("/health", h)\nhttp.HandleFunc("/metrics", m)\n'),
    src("api/users.test.ts", 'app.get("/only-in-tests", h);\n'),
  ]).map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(routes, ["GET /users/{user_id}", "GET /orders/:id", "POST /orders", "GET /api/items/:id", "POST /api/items/:id", "GET /health", "ANY /metrics"]);
  assert.equal(callPath("${API}/users/${id}?x=1"), "/users/:x");
  assert.equal(callPath("https://api.example.com/v1/x"), "/v1/x");
  assert.equal(callPath("relative/path"), null);
  const calls = findCalls([src("web/a.ts", 'apiFetch("/users/42", { method: "GET" });\nconst r = await fetch(`/api/items/${id}`, { method: "POST" });\n', "web")]);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /users/42", "POST /api/items/:x"]);
  const all = findRoutes([src("api/users.py", 'router = APIRouter(prefix="/users")\n@router.get("/{user_id}")\n'), src("web/app/api/items/[id]/route.ts", "export function POST() {}\n")]);
  assert.equal(matchCall(calls[0]!, all)?.path, "/users/{user_id}");
  assert.equal(matchCall(calls[1]!, all)?.method, "POST");
  assert.ok(isTest("backend/tests/test_x.py") && isTest("a/b.spec.ts") && isTest("e2e/login.ts") && !isTest("src/contest.ts"));
  assert.deepEqual(composeServices("services:\n  web:\n    build:\n      context: ./web\n    depends_on:\n      api:\n        condition: service_healthy\n    environment:\n      API_URL: http://api\n"),
    [{ name: "web", build: "./web", ports: [], dependsOn: ["api"], env: ["API_URL"] }]);
});
