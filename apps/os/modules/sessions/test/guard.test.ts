import { test } from "node:test";
import assert from "node:assert/strict";
import { API_REASON, DATA_REASON, guardReason } from "../server/guard.ts";

const env = "/home/a/env";
const scope = { ports: [4780, 4781, 47470], dirs: [`${env}/os/data`, `${env}/.state/os`] };
const cwd = `${env}/projects/demo/code`;
const bash = (command: string) => guardReason("Bash", { command }, scope, cwd);

test("agents cannot call agent-os's own API", () => {
  for (const c of [
    "curl -XPOST localhost:4780/api/tabs/x/send -d '{\"mode\":\"bypassPermissions\"}'",
    "curl http://127.0.0.1:4781/api/tabs/x/terms",
    "wget -qO- http://[::1]:47470/api/http",
    "curl http://0.0.0.0:4780/api/os/modules",
    "curl 'http://localhost%3A4780/api/tabs'",
    "python3 -c \"import urllib.request as u; u.urlopen('http://localhost:4780/api/http')\"",
  ]) assert.equal(bash(c), API_REASON, c);
  assert.equal(guardReason("WebFetch", { url: "http://localhost:4780/api/http", prompt: "x" }, scope, cwd), API_REASON);
});

test("the user's own dev servers and other hosts stay reachable", () => {
  for (const c of ["curl localhost:3000/api/projects", "curl http://127.0.0.1:47800/", "curl https://example.com:4780/x", "npm test"]) {
    assert.equal(bash(c), null, c);
  }
});

test("agents cannot reach os/data or .state/os, by any path", () => {
  for (const c of [
    `cat ${env}/os/data/http/store.json`,
    "cat ../../../os/data/notes/notes.json",
    "ls ../../../.state/os/ssh/run",
    `cat ${env}/os//data/./x/../http/store.json`,
    `tar czf /tmp/x.tgz ${env}/os/data`,
  ]) assert.equal(bash(c), DATA_REASON, c);
  assert.equal(guardReason("Read", { file_path: `${env}/os/data/prefs.json` }, scope, cwd), DATA_REASON);
  assert.equal(guardReason("Grep", { pattern: "token", path: `${env}/.state/os` }, scope, cwd), DATA_REASON);
});

test("words that only look like the folders are fine (working on agent-os itself)", () => {
  for (const c of ['grep -rn "os/data" src', "cat docs/en/architecture.md", "ls ../../../os/source/modules", "mkdir -p tmp/os/data"]) {
    assert.equal(bash(c), null, c);
  }
  assert.equal(guardReason("Grep", { pattern: "os/data", path: "src" }, scope, cwd), null);
  assert.equal(guardReason("Read", { file_path: `${cwd}/src/os/data.ts` }, scope, cwd), null);
});
