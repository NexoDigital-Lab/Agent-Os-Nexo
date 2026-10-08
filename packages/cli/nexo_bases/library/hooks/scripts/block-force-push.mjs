#!/usr/bin/env node
// Blocks force pushes. The pending command comes either as arguments or, for tools that send hook
// payloads as JSON on stdin (e.g. Claude Code's PreToolUse), from `tool_input.command`.
// Exit 2 blocks the action; exit 0 lets it through.
import { readFileSync } from "node:fs";

/**
 * True when some command in `command` is a `git … push` that overwrites remote history: --force,
 * --force-with-lease, --mirror, a short-flag cluster carrying f (-f, -uf), or a `+` refspec (`+main`). Git's own
 * options may come before `push` (`git -C dir push`, `git -c k=v push`).
 */
export function isForcePush(command) {
  for (const segment of String(command).split(/&&|\|\||[;|&\n]/)) {
    const words = segment.trim().split(/\s+/).map((w) => w.replace(/^["']|["']$/g, ""));
    const git = words.findIndex((w) => w === "git" || /[\\/]git(\.exe)?$/.test(w));
    if (git < 0) continue;
    // The subcommand is the first word after git's own options (-C <dir> and -c <k=v> take a value).
    let push = git + 1;
    while (push < words.length && words[push].startsWith("-")) push += /^-[Cc]$/.test(words[push]) ? 2 : 1;
    if (words[push] !== "push") continue;
    for (const w of words.slice(push + 1)) {
      if (/^--(force|force-with-lease|mirror)(=|$)/.test(w)) return true;
      if (/^-[A-Za-z]*f[A-Za-z]*$/.test(w)) return true;
      if (/^\+[^\s]/.test(w)) return true;
    }
  }
  return false;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  let command = process.argv.slice(2).join(" ");
  if (!command && !process.stdin.isTTY) {
    try {
      command = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.command ?? "";
    } catch {
      command = "";
    }
  }
  if (isForcePush(command)) {
    console.error("Blocked by Nexo: force push is not allowed for agents.");
    process.exit(2);
  }
  process.exit(0);
}
