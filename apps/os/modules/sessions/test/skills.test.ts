// skills: prefs in library/profile.json, the skill listing (library + ~/.claude/skills) and recommendations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir, tempEnv } from "../../../host/test/harness.ts";

// ~/.claude/skills is read through os.homedir(): point it at a temp folder before the module loads.
const home = tempDir("skills-home-");
process.env.HOME = home;
process.env.USERPROFILE = home;
const env = tempEnv();
const { initSkills, listSkills, readPrefs, recommendSkills, userLanguage, writePrefs } = await import("../server/skills.ts");
initSkills(env);

const skill = (dir: string, name: string, fm: string, body = "body") => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\n${fm}\n---\n${body}`);
};

test("prefs default to empty, round-trip, and keep the rest of the profile", () => {
  assert.deepEqual(readPrefs(), { disabled: [], pinned: [] });
  assert.equal(userLanguage(), "en");
  writeFileSync(join(env.library, "profile.json"), JSON.stringify({ language: "es", name: "A" }));
  writePrefs({ disabled: ["b"], pinned: ["a"] });
  assert.deepEqual(readPrefs(), { disabled: ["b"], pinned: ["a"] });
  const saved = JSON.parse(readFileSync(join(env.library, "profile.json"), "utf8"));
  assert.equal(saved.name, "A");
  assert.equal(userLanguage(), "es");
});

test("listSkills merges library and ~/.claude/skills, shortens descriptions, applies prefs", () => {
  assert.deepEqual(listSkills(), []);
  const lib = join(env.library, "skills");
  skill(lib, "zeta", "owner: nexo\ndescription: First sentence. Second sentence.");
  skill(lib, "alpha", `description: ${"x".repeat(200)}`);
  skill(lib, "synced", "description: skipped");
  mkdirSync(join(lib, "nofile"), { recursive: true });
  const mine = join(home, ".claude", "skills");
  skill(mine, "alpha", "description: shadowed by the library");
  skill(mine, "personal", "description: \"Quoted\"", "x".repeat(400));
  writePrefs({ disabled: ["zeta"], pinned: ["personal"] });
  const list = listSkills();
  assert.deepEqual(list.map((s) => s.name), ["alpha", "personal", "zeta"]);
  const by = Object.fromEntries(list.map((s) => [s.name, s]));
  assert.equal(by.zeta!.source, "nexo");
  assert.equal(by.zeta!.description, "First sentence.");
  assert.equal(by.zeta!.enabled, false);
  assert.equal(by.alpha!.source, "library");
  assert.equal(by.alpha!.description.length, 138);
  assert.ok(by.alpha!.description.endsWith("…"));
  assert.equal(by.personal!.source, "claude");
  assert.equal(by.personal!.description, "Quoted");
  assert.equal(by.personal!.pinned, true);
  assert.ok(by.personal!.tokens >= 100);
});

const fake = (msgs: unknown[], seen: any[] = []) =>
  ((args: unknown) => {
    seen.push(args);
    return (async function* () {
      for (const m of msgs) yield m;
    })();
  }) as any;

test("recommendSkills keeps only known enabled skills and adds pinned ones", async () => {
  const seen: any[] = [];
  const r = await recommendSkills("fix a bug", "shop", fake([
    { type: "result", subtype: "success", total_cost_usd: 0.1, structured_output: { skills: [{ name: "alpha", why: "w" }, { name: "zeta", why: "disabled" }, { name: "ghost", why: "unknown" }] } },
  ], seen));
  assert.deepEqual(r, { skills: [{ name: "alpha", why: "w" }, { name: "personal", why: "" }], cost: 0.1 });
  assert.match(seen[0].prompt, /Project: shop/);
  assert.match(seen[0].prompt, /Task: fix a bug/);
  assert.match(seen[0].prompt, /- alpha \(/);
  assert.doesNotMatch(seen[0].prompt, /- zeta/);
  assert.match(seen[0].prompt, /language with code "es"/);
});

test("recommendSkills: failed or empty runs still return the pinned skills", async () => {
  const seen: any[] = [];
  const failed = await recommendSkills("t", null, fake([{ type: "result", subtype: "error_max_turns", total_cost_usd: 0.2 }], seen));
  assert.deepEqual(failed, { skills: [{ name: "personal", why: "" }], cost: 0.2 });
  assert.match(seen[0].prompt, /Project: \(none\)/);
  const bare = await recommendSkills("t", null, fake([{ type: "result", subtype: "success", total_cost_usd: 0, structured_output: null }]));
  assert.deepEqual(bare.skills.map((s) => s.name), ["personal"]);
});

// ---- CLI providers (round 3): the recommender rides the selected provider ------------------------
const providersHost = await import("../../../host/server/providers.ts");

test("recommendSkills routes a CLI provider through askWithProvider and parses the JSON answer", async () => {
  const realRun = providersHost.providerExec.run;
  const realFind = providersHost.providerExec.find;
  providersHost.providerExec.find = (n: string) => (n === "opencode" || n === "opencode.cmd" ? `/fake/${n}` : null);
  const asks: { args: string[]; opts: { timeout?: number } }[] = [];
  providersHost.providerExec.run = ((_c: string, args: string[], opts: { timeout?: number }) => {
    asks.push({ args, opts });
    return Promise.resolve({ stdout: '```json\n{"skills":[{"name":"alpha","why":"pick"}]}\n```', stderr: "" });
  }) as unknown as typeof providersHost.providerExec.run;
  try {
    // The fake run stays as the 3rd arg: the old Claude-only path would use it and fail these asserts (RED).
    const r = await recommendSkills("fix", "shop", fake([{ type: "result", subtype: "error_max_turns", total_cost_usd: 0 }]), {
      provider: "opencode",
      model: "opencode/mimo-v2.6-flash-free",
      cwd: env.library,
    });
    assert.deepEqual(r, { skills: [{ name: "alpha", why: "pick" }, { name: "personal", why: "" }], cost: 0 });
    const argv = asks[0].args.join(" ");
    assert.match(argv, /run/);
    assert.match(argv, /--model opencode\/mimo-v2\.6-flash-free/);
    assert.match(argv, /"skills"/, "the CLI prompt asks for the JSON shape");
    assert.equal(asks[0].opts.timeout, 120_000, "a recommend is a one-shot: the 120s budget");
  } finally {
    providersHost.providerExec.run = realRun;
    providersHost.providerExec.find = realFind;
  }
});

test("recommendSkills: an unparseable CLI answer degrades to the pinned skills", async () => {
  const realRun = providersHost.providerExec.run;
  const realFind = providersHost.providerExec.find;
  providersHost.providerExec.find = (n: string) => (n === "opencode" || n === "opencode.cmd" ? `/fake/${n}` : null);
  const asks: unknown[] = [];
  providersHost.providerExec.run = ((_c: string, args: string[]) => {
    asks.push(args);
    return Promise.resolve({ stdout: "sorry, I cannot help", stderr: "" });
  }) as unknown as typeof providersHost.providerExec.run;
  try {
    const r = await recommendSkills("t", null, fake([{ type: "result", subtype: "error_max_turns", total_cost_usd: 0 }]), {
      provider: "opencode",
      cwd: env.library,
    });
    assert.equal(asks.length, 1, "the CLI was spawned");
    assert.deepEqual(r, { skills: [{ name: "personal", why: "" }], cost: 0 });
  } finally {
    providersHost.providerExec.run = realRun;
    providersHost.providerExec.find = realFind;
  }
});
