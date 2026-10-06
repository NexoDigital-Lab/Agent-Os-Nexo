import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Vault } from "../server/vault.ts";
import type { SshHostInput } from "../server/types.ts";

const tmp = () => path.join(mkdtempSync(path.join(os.tmpdir(), "agos-vault-")), "ssh");
const host: SshHostInput = { name: "web", host: "10.0.0.5", port: 22, user: "deploy", auth: "password", project: null, secret: "hunter2-password" };

test("setup, save and unlock roundtrip with a new instance (a server restart)", async () => {
  const dir = tmp();
  const v = new Vault(dir);
  assert.equal(v.state(), "setup");
  await v.setup("correct horse battery");
  assert.equal(v.state(), "unlocked");
  const added = v.add(host);
  assert.equal(added.hasSecret, true);
  assert.equal("secret" in added, false);

  const again = new Vault(dir);
  assert.equal(again.state(), "locked");
  assert.throws(() => again.list(), /locked/);
  await again.unlock("correct horse battery");
  assert.equal(again.list().length, 1);
  assert.equal(again.get(added.id)?.secret, "hunter2-password");
  assert.ok(!JSON.stringify(again.list()).includes("hunter2"));
  rmSync(dir, { recursive: true });
});

test("the file holds no plaintext and a wrong password fails with 401", async () => {
  const dir = tmp();
  const v = new Vault(dir);
  await v.setup("correct horse battery");
  v.add(host);
  const raw = readFileSync(path.join(dir, "vault.json"), "utf8");
  assert.ok(!raw.includes("hunter2") && !raw.includes("10.0.0.5") && !raw.includes("deploy"));
  const other = new Vault(dir);
  await assert.rejects(other.unlock("not the password"), (e: any) => e.status === 401 && /Wrong password/.test(e.message));
  assert.equal(other.state(), "locked");
  rmSync(dir, { recursive: true });
});

test("every save uses a fresh IV, and the file and folder are private", async () => {
  const dir = tmp();
  const v = new Vault(dir);
  await v.setup("correct horse battery");
  const ivs = new Set<string>();
  const read = () => JSON.parse(readFileSync(path.join(dir, "vault.json"), "utf8"));
  ivs.add(read().iv);
  v.add(host);
  ivs.add(read().iv);
  v.add({ ...host, name: "db" });
  ivs.add(read().iv);
  assert.equal(ivs.size, 3);
  assert.equal(read().N, 2 ** 17);
  if (process.platform !== "win32") {
    // Windows does not enforce Unix file modes
    assert.equal(statSync(path.join(dir, "vault.json")).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  }
  rmSync(dir, { recursive: true });
});

test("update keeps secrets unless told otherwise; changing the auth kind drops them", async () => {
  const dir = tmp();
  const v = new Vault(dir);
  await v.setup("correct horse battery");
  const { id } = v.add(host);
  const { secret: _s, ...noSecret } = host;
  assert.equal(v.update(id, { ...noSecret, name: "renamed" })?.hasSecret, true);
  assert.equal(v.get(id)?.secret, "hunter2-password");
  assert.equal(v.update(id, { ...noSecret, secret: "" })?.hasSecret, false);
  v.update(id, { ...noSecret, secret: "pw" });
  assert.equal(v.update(id, { ...noSecret, auth: "key" })?.hasSecret, false);
  assert.equal(v.update("nope", noSecret), null);
  assert.equal(v.remove(id), true);
  assert.equal(v.remove(id), false);
  rmSync(dir, { recursive: true });
});

test("lock wipes memory and tokens; five wrong passwords trigger a cooldown", async () => {
  const dir = tmp();
  const v = new Vault(dir);
  await v.setup("correct horse battery");
  const t = v.issueToken();
  assert.equal(v.validToken(t), true);
  assert.equal(v.validToken(t.slice(0, -1) + (t.endsWith("0") ? "1" : "0")), false);
  assert.equal(v.validToken("short"), false);
  assert.equal(v.validToken(undefined), false);
  v.lock();
  assert.equal(v.validToken(t), false);
  assert.equal(v.state(), "locked");
  for (let i = 0; i < 5; i++) await assert.rejects(v.unlock("wrong password"), (e: any) => e.status === 401);
  await assert.rejects(v.unlock("correct horse battery"), (e: any) => e.status === 429);
  rmSync(dir, { recursive: true });
});

test("a burst of parallel wrong guesses gets at most five tries, then the cooldown", async () => {
  const dir = tmp();
  await new Vault(dir).setup("correct horse battery");
  const v = new Vault(dir);
  const codes = await Promise.all(Array.from({ length: 8 }, (_, i) => v.unlock(`wrong-${i}`).then(() => 200, (e: any) => e.status)));
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429, 429]);
  rmSync(dir, { recursive: true });
});
