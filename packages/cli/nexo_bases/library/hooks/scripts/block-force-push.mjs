#!/usr/bin/env node
// Blocks force pushes. The pending command comes either as arguments or, for tools that send hook
// payloads as JSON on stdin (e.g. Claude Code's PreToolUse), from `tool_input.command`.
// Exit 2 blocks the action; exit 0 lets it through.
import { readFileSync } from "node:fs";

let command = process.argv.slice(2).join(" ");
if (!command && !process.stdin.isTTY) {
  try {
    command = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.command ?? "";
  } catch {
    command = "";
  }
}
if (/\bgit\s+push\b/.test(command) && /(\s--force(-with-lease)?\b|\s-f\b)/.test(command)) {
  console.error("Blocked by Nexo: force push is not allowed for agents.");
  process.exit(2);
}
process.exit(0);
