import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSendBody } from "../server/sendBody.ts";

test("a valid send body passes, with defaults", () => {
  assert.deepEqual(parseSendBody({ prompt: "hi" }), { prompt: "hi", skills: [], images: [], mode: "default", model: undefined, agent: undefined, workMode: undefined, provider: undefined });
  const full = parseSendBody({ prompt: "x", skills: ["nexo-dev"], images: ["a1.png"], mode: "plan", model: "sonnet", agent: "build", workMode: "focus", provider: "opencode" });
  assert.equal(full.mode, "plan");
  assert.equal(full.workMode, "focus");
  assert.equal(full.provider, "opencode");
  assert.equal(full.agent, "build");
});

test("a malformed send body is refused before the tab changes", () => {
  for (const [body, re] of [
    [{}, /prompt must be non-empty/],
    [{ prompt: "  " }, /prompt must be non-empty/],
    [{ prompt: "x", images: "a" }, /images must be a list/],
    [{ prompt: "x", skills: [{}] }, /skills must be a list/],
    [{ prompt: "x", images: ["../../etc/passwd"] }, /images must be a list/],
    [{ prompt: "x", mode: "yolo" }, /mode must be one of/],
    [{ prompt: "x", workMode: "turbo" }, /workMode must be one of/],
    [{ prompt: "x", model: "a b" }, /Invalid model/],
    [{ prompt: "x".repeat(100_001) }, /longer than/],
  ] as const) {
    assert.throws(() => parseSendBody(body), re, JSON.stringify(body).slice(0, 60));
  }
});

test("agent is optional; a valid agent passes and a malformed one is a 400", () => {
  assert.equal(parseSendBody({ prompt: "x" }).agent, undefined);
  assert.equal(parseSendBody({ prompt: "x", agent: "build" }).agent, "build");
  assert.equal(parseSendBody({ prompt: "x", agent: "sdd-orchestador-shini-orchestador" }).agent, "sdd-orchestador-shini-orchestador");
  for (const agent of ["", "bad agent!", "a".repeat(101), "has/slash", "has:colon", "has space"]) {
    assert.throws(() => parseSendBody({ prompt: "x", agent }), (e: any) => e.status === 400 && /Invalid agent/.test(e.message), JSON.stringify(agent));
  }
});

test("model passes through for CLI providers with provider/model ids; claude keeps its enum validation", () => {
  // CLI provider: model uses the shared validator (allows provider/model with / and :)
  const cli = parseSendBody({ prompt: "x", provider: "opencode", model: "opencode/mimo-v2.6-pro" });
  assert.equal(cli.model, "opencode/mimo-v2.6-pro");
  const cliCodex = parseSendBody({ prompt: "x", provider: "codex", model: "gpt-5:mini" });
  assert.equal(cliCodex.model, "gpt-5:mini");
  // Malformed model for a CLI provider is a 400
  assert.throws(() => parseSendBody({ prompt: "x", provider: "opencode", model: "bad model!" }), (e: any) => e.status === 400 && /Invalid model/.test(e.message));
  // Claude: existing enum validation stays (sonnet/opus/haiku pass, provider/model format does not)
  const claude = parseSendBody({ prompt: "x", provider: "claude", model: "sonnet" });
  assert.equal(claude.model, "sonnet");
  assert.throws(() => parseSendBody({ prompt: "x", provider: "claude", model: "opencode/mimo" }), (e: any) => e.status === 400 && /Invalid model/.test(e.message));
  // No provider in the body: existing MODEL regex applies
  const none = parseSendBody({ prompt: "x", model: "sonnet" });
  assert.equal(none.model, "sonnet");
  assert.throws(() => parseSendBody({ prompt: "x", model: "opencode/mimo" }), (e: any) => e.status === 400 && /Invalid model/.test(e.message));
});
