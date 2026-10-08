// The restart helper (restart.ts): reads a RelaunchPlan on stdin, waits for the old server to end, starts the new one
// detached with its output in the launcher's log, records its pid for the launcher, and exits.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RelaunchPlan } from "./restart.ts";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
const plan = JSON.parse(input) as RelaunchPlan;

// The old server frees the port as it exits; give it up to 20 s (open sockets, a slow shutdown).
for (const until = Date.now() + 20_000; alive(plan.waitFor) && Date.now() < until; ) await new Promise((r) => setTimeout(r, 100));

mkdirSync(dirname(plan.log), { recursive: true });
const fd = openSync(plan.log, "a");
const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: plan.env, detached: true, windowsHide: true, stdio: ["pipe", fd, fd] });
closeSync(fd);
child.stdin?.end(`${plan.token}\n`); // the token on stdin, never in the environment
child.unref();
if (plan.pidFile && child.pid) writeFileSync(plan.pidFile, String(child.pid));
