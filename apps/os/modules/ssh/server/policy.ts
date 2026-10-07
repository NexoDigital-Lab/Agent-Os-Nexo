// Pure rules of the SSH feature, no I/O: which remote commands are read-only, what is scrubbed from console output
// before the agent sees it, and which local tool calls the agent may never make (they would reach the credentials).
import os from "node:os";
import path from "node:path";

class Refuse extends Error {}
const refuse = (why: string): never => {
  throw new Refuse(why);
};

// ── read-only commands ──────────────────────────────────────────────────────────────────────────────────────────

type Tok = { v: string; glob: boolean };

/**
 * Splits `cmd` into pipeline segments of words. Anything that could chain, redirect, expand or inject (`; & > < $ \`
 * backticks, parentheses, `!`, control characters…) is refused outright: the console is an interactive shell, so even
 * `!!` or a tab character would do something. Single quotes are inert; double quotes allow no expansion at all.
 */
function tokenize(cmd: string): Tok[][] {
  if (/[\x00-\x1f\x7f]/.test(cmd)) refuse("has line breaks or control characters");
  const segs: Tok[][] = [[]];
  let cur = "", has = false, glob = false, quote: "'" | '"' | null = null;
  const endTok = () => {
    if (has) segs[segs.length - 1].push({ v: cur, glob });
    cur = "";
    has = glob = false;
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i], next = cmd[i + 1];
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if ("\\`$!".includes(c)) refuse(`uses "${c}" inside double quotes`);
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === " ") endTok();
    else if (c === "|") {
      if (next === "|") refuse("chains with ||");
      endTok();
      if (!segs[segs.length - 1].length) refuse("has an empty pipe");
      segs.push([]);
    } else if (";&<>`$(){}!\\".includes(c)) refuse(`uses "${c}"`);
    else {
      if ("*?[".includes(c)) glob = true;
      cur += c;
      has = true;
    }
  }
  if (quote) refuse("has unclosed quotes");
  endTok();
  if (!segs[segs.length - 1].length) refuse("is empty or ends in a pipe");
  return segs;
}

// Names (and paths) whose content must never reach the agent. Matched against every word of every segment.
const SENSITIVE = [
  /\.env/i, // no start anchor: `foo.env`, `HEAD:.env` and `a//.env` all count
  /id_(rsa|dsa|ecdsa|ed25519)/i,
  /\.(pem|key|p12|pfx)$/i,
  /shadow/i,
  /\.pgpass|\.netrc|\.git-credentials|\.npmrc|\.pypirc|authorized_keys/i,
  /credentials|secrets?/i,
  /(^|\/)\.(aws|ssh|gnupg|kube)(\/|$)/,
  /\.docker\/config\.json/,
  /(^|[^a-z])environ([^a-z]|$)/i, // /proc/<pid>/environ however it is reached (`fd/..`, `task/1/`), but not "environment"
  /\/proc\/(?:.*\/)?(mem|maps)$/,
];
// What a glob in a content-reading command could expand to (shell `*` skips dotfiles, `.*` does not).
const SENSITIVE_NAMES = [".env", ".env.local", ".env.production", "id_rsa", "id_ed25519", "id_ecdsa", "shadow", "gshadow", "credentials", "secrets", "authorized_keys", ".pgpass", ".netrc", ".git-credentials", ".npmrc", ".pypirc", "server.pem", "server.key", "environ", "mem", "maps", ".ssh", ".aws", ".gnupg", ".kube"];
// Programs that only print names/metadata or counts, so `du -sh /var/*` is fine. Every other program also gets the glob check,
// since an option (`date -f .en*`) can turn a file name into a file read.
const NAMES_ONLY = new Set(["ls", "du", "df", "stat", "wc", "pgrep", "which", "find", "lsblk", "free", "uptime", "whoami", "id", "pwd", "uname", "hostname", "ps", "ss", "netstat", "ip", "top", "nginx", "systemctl", "journalctl", "docker"]);

function globHitsSensitive(pattern: string): boolean {
  const parts = pattern.split("/").filter(Boolean);
  return parts.some((part, i) => {
    if (!/[*?[]/.test(part) || (i < parts.length - 1 && /^\*+$/.test(part))) return false; // a bare `*` in the middle is too common to refuse
    try {
      const re = new RegExp("^" + part.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".").replace(/\[!/g, "[^") + "$");
      return SENSITIVE_NAMES.some((n) => re.test(n) && (!n.startsWith(".") || part.startsWith(".") || part.startsWith("[")));
    } catch {
      return true; // a pattern we cannot read is a pattern we do not run
    }
  });
}

/** The word, its `=`/`:`/`,` pieces (`--files0-from=.env`, `HEAD:.env`), each also lexically normalized (`a//./b/../c`). */
const pieces = (v: string) => [v, ...v.split(/[=:,]/)].filter(Boolean).flatMap((p) => [p, path.posix.normalize(p)]);

type Rule = (args: string[], piped: boolean) => string | null;
const any = () => null;
const has = (args: string[], test: (a: string) => boolean) => args.find(test);
const flagsOnly = (a: string[], allowed: RegExp) => a.every((x) => allowed.test(x));
// getopt_long accepts any prefix of a long option (`--recurs`), so a blacklist must match prefixes, not just full names.
const abbrev = (x: string, ...longs: string[]) => x.startsWith("--") && x.length >= 3 && longs.some((l) => l.startsWith(x.split("=")[0]));
const anyAbbrev = (a: string[], ...longs: string[]) => a.some((x) => abbrev(x, ...longs));

const grepRule: Rule = (a) =>
  has(a, (x) => /^-[a-zA-Z]*[rR]/.test(x) || abbrev(x, "--recursive", "--dereference-recursive", "--directories") || x.includes("recurse"))
    ? "a recursive search could read files with secrets"
    : null;

// ps: BSD `e` prints every process's environment, and GNU `-o env` too, so only known-harmless options pass.
const PS_FLAGS = new Set(["-e", "-f", "-ef", "-A", "-a", "-x", "-H", "-w", "-ww", "-l", "-aux", "-ax", "aux", "ax", "auxf", "auxww", "axf", "axww", "--forest", "--no-headers"]);
const psRule: Rule = (a) => {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (PS_FLAGS.has(x)) continue;
    const sort = /^--sort=(.*)$/.exec(x);
    const val = sort ? sort[1] : ["-u", "-U", "-p", "-o", "-eo", "-C", "--sort"].includes(x) ? a[++i] : undefined;
    if (val === undefined || !/^[\w%,=:+.-]+$/.test(val) || /env/i.test(val)) return "ps is only allowed with known options (e/env shows the processes' environment)";
  }
  return null;
};

// rg searches the working directory when given no path, so it only runs on piped input or one explicit file.
const RG_LONG = /^--(ignore-case|line-number|count|fixed-strings|word-regexp|invert-match|no-filename|with-filename|only-matching|files-with-matches|smart-case)$/;
const rgRule: Rule = (a, piped) => {
  const pos: string[] = [];
  let pattern = false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--") {
      pos.push(...a.slice(i + 1));
      break;
    } else if (RG_LONG.test(x) || /^-[inwxFvcHhoslLS]+$/.test(x)) continue;
    else if (/^--(max-count|context|after-context|before-context)(=\d+)?$/.test(x) || /^-[ABCm]\d*$/.test(x)) {
      if (!/\d$/.test(x)) i++;
    } else if (x === "-e") {
      pattern = true;
      i++;
    } else if (x.startsWith("-")) return "that rg option reads hidden files, runs programs or walks directories";
    else pos.push(x);
  }
  const paths = pattern ? pos : pos.slice(1);
  if (paths.length === 0) return piped ? null : "rg without a file walks the current directory";
  const f = paths[0];
  // Only a plain file with an extension is known not to be a directory (heuristic: a directory would be searched recursively).
  return paths.length === 1 && /\.\w+$/.test(f) && !/[*?[]|\.\.|\/$/.test(f) ? null : "rg only with an explicit file (a directory is walked whole)";
};

const RULES: Record<string, Rule> = {
  ls: any, cat: any, head: any, tail: any, du: any, df: any, free: any, uptime: any, pgrep: any, whoami: any, id: any, pwd: any,
  uname: any, stat: any, wc: any, which: any, netstat: any, lsblk: any, cut: any, tr: any, nl: any,
  file: (a) => (has(a, (x) => /^-[a-zA-Z]*[fC]/.test(x)) || anyAbbrev(a, "--files-from", "--compile") ? "file -f reads a list of files and -C writes" : null),
  hostname: (a) => (flagsOnly(a, /^-[fisdIAay]+$/) ? null : "hostname with arguments changes the name"),
  date: (a) => (has(a, (x) => /^-[a-zA-Z]*[sf]/.test(x)) || anyAbbrev(a, "--set", "--file") ? "date -s changes the time and -f reads files" : null),
  uniq: (a) => (a.filter((x) => !x.startsWith("-")).length > 1 ? "uniq with a second file writes it" : null),
  sort: (a) => (has(a, (x) => /^-[a-zA-Z]*o/.test(x)) || anyAbbrev(a, "--output", "--compress-program") ? "sort -o writes files" : null),
  ss: (a) => (has(a, (x) => /^-[a-zA-Z]*[KD]/.test(x)) || anyAbbrev(a, "--kill", "--diag") ? "ss -K closes connections and -D writes files" : null),
  ps: psRule,
  top: (a) => (["-bn1", "-b -n1", "-b -n 1", "-n1 -b", "-n 1 -b"].includes(a.join(" ")) ? null : "top is only allowed as -bn1"),
  nginx: (a) => (a.join(" ") === "-t" ? null : "nginx is only allowed as -t"),
  grep: grepRule,
  egrep: grepRule,
  rg: rgRule,
  find: (a) => (has(a, (x) => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls|files0-from)$/.test(x)) ? "find with actions changes things" : null),
  journalctl: (a) =>
    anyAbbrev(a, "--vacuum-size", "--vacuum-time", "--vacuum-files", "--rotate", "--flush", "--sync", "--relinquish-var", "--smart-relinquish-var", "--setup-keys", "--update-catalog")
      ? "journalctl that modifies the journal"
      : null,
  systemctl: (a) => {
    if (has(a, (x) => /^-[a-zA-Z]*[HM]/.test(x)) || anyAbbrev(a, "--host", "--machine")) return "systemctl remoto";
    const sub = a.find((x) => !x.startsWith("-"));
    return sub && ["status", "is-active", "is-enabled", "list-units", "list-timers", "show"].includes(sub) ? null : `systemctl ${sub ?? ""} is not read-only`;
  },
  docker: (a) => {
    const [sub, next] = a;
    if (sub === "compose") return next === "ps" || next === "logs" ? null : "docker compose only allows ps and logs";
    if (sub === "stats") return a.includes("--no-stream") ? null : "docker stats necesita --no-stream";
    return ["ps", "logs", "images", "inspect", "version", "info"].includes(sub) ? null : `docker ${sub ?? ""} is not read-only`;
  },
  git: (a) => {
    const [sub, ...rest] = a;
    if (has(rest, (x) => /^-O/.test(x) || abbrev(x, "--output", "--ext-diff", "--open-files-in-pager"))) return "git with that option writes files or runs programs";
    if (sub === "branch") return flagsOnly(rest, /^(-a|-r|-v|-vv|-l|--list|--show-current|--all|--remotes|--verbose|--no-color)$/) ? null : "git branch only to list";
    if (sub === "remote") return rest.length === 0 || (rest.length === 1 && ["-v", "--verbose"].includes(rest[0])) ? null : "git remote only with -v";
    return ["status", "log", "diff", "show"].includes(sub) ? null : `git ${sub ?? ""} is not read-only`;
  },
  ip: (a) => {
    if (a.some((x) => x.startsWith("-") && !/^-(4|6|s|d|c|o|br|j|p|brief|json|color|details|oneline|stats|statistics)$/.test(x))) return "ip with that option";
    const [obj, verb] = a.filter((x) => !x.startsWith("-"));
    if (!["a", "addr", "address", "r", "route", "link"].includes(obj)) return "ip only for addr, route and link";
    return verb === undefined || ["show", "list", "ls", "sh", "s", "get"].includes(verb) ? null : "ip that changes the network";
  },
  sed: (a) => {
    let quiet = false;
    const pos: string[] = [];
    for (const x of a) {
      if (x === "--quiet" || x === "--silent") quiet = true;
      else if (/^-[nEr]+$/.test(x)) quiet ||= x.includes("n");
      else if (x.startsWith("-")) return "that sed option can write files";
      else pos.push(x);
    }
    if (!quiet) return "sed is only allowed with -n";
    const addr = String.raw`(?:\d+|\$|/(?:[^/\\]|\\.)*/)`;
    return pos[0] !== undefined && new RegExp(`^\\s*(?:${addr}(?:\\s*,\\s*${addr})?\\s*)?p\\s*$`).test(pos[0]) ? null : "sed only allows scripts of the form [range]p";
  },
  awk: (a) => {
    const pos: string[] = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === "-v" || a[i] === "-F") i++;
      else if (/^-F./.test(a[i])) continue;
      else if (a[i].startsWith("-")) return "that awk option reads or writes files";
      else pos.push(a[i]);
    }
    return pos[0] === undefined || /system\s*\(|>|\||getline|ENVIRON|close\s*\(|@|`/.test(pos[0]) ? "that awk script can write or run things" : null;
  },
};

/** Why `cmd` is not safe to run without the user's approval, or null when it is read-only. */
export function explainReadOnly(cmd: string): string | null {
  try {
    tokenize(cmd.trim()).forEach((seg, idx) => {
      const [prog, ...args] = seg.map((t) => t.v);
      if (!Object.hasOwn(RULES, prog)) refuse(`${prog} is not in the list of read-only commands`);
      // A `#` word would comment out the end marker the console appends to the command.
      if (seg.some((t) => t.v.startsWith("#"))) refuse("has a \"#\" comment");
      // Same for every program: an option that reads its file names from a file defeats the sensitive-name check.
      if (anyAbbrev(args, "--files0-from", "--file")) refuse("that option reads a list of files from another file");
      const bad = RULES[prog](args, idx > 0);
      if (bad) refuse(bad);
      if (seg.some((t) => pieces(t.v).some((p) => SENSITIVE.some((re) => re.test(p))))) refuse("names a sensitive file");
      if (!NAMES_ONLY.has(prog) && seg.some((t) => t.glob && pieces(t.v).some(globHitsSensitive))) refuse("the wildcard could match sensitive files");
    });
    return null;
  } catch (e) {
    if (e instanceof Refuse) return e.message;
    throw e;
  }
}

/** True when `cmd` only looks at things (pipes allowed) and never touches credentials: the agent may run it unprompted. */
export const isReadOnly = (cmd: string) => explainReadOnly(cmd) === null;

// ── console output ──────────────────────────────────────────────────────────────────────────────────────────────

/** Masks what looks like a secret in text that is about to reach the agent (the host's shared scrubber). */
export { redact } from "../../../host/server/redact.ts";

// ── barriers on the agent's own tools (PreToolUse, every agent-os session) ─────────────────────────────────────────

const SSH_BINS = new Set(["ssh", "scp", "sftp", "sshpass", "ssh-add", "ssh-agent", "ssh-copy-id", "autossh", "mosh", "mosh-client", "sshfs"]);
const DEBUGGERS = new Set(["gdb", "strace", "ltrace", "lldb", "gcore"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish", "su", "script"]);
const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "{", "}", "!", "time"]);
// Commands that run another command, and the options of theirs that take a value (so the real program is found).
const WRAPPERS: Record<string, string[]> = {
  sudo: ["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U"], doas: ["-u", "-C"], env: ["-u", "-C", "-S"], exec: [], nohup: [], command: [],
  builtin: [], xargs: ["-I", "-n", "-L", "-P", "-d", "-E", "-s", "-a"], nice: ["-n"], ionice: ["-c", "-n", "-p"], timeout: ["-s", "-k"], setsid: [], stdbuf: ["-i", "-o", "-e"],
  watch: ["-n", "-d"],
};

const WHY = {
  ssh: "Direct ssh/scp/sftp are blocked for the agent: they would skip the approval. To work on a server use the tab's SSH console (ssh_run / ssh_plan).",
  vault: "The SSH vault and its credentials are not accessible to the agent.",
  api: "The SSH vault API (/api/ssh) is only for the agent-os interface, not for the agent.",
  key: "SSH private keys are not accessible to the agent (the public .pub is).",
  proc: "Other processes' memory and environment (/proc/<pid>/mem|environ|maps) are not accessible to the agent.",
  ptrace: "Attaching debuggers or using ptrace on other processes is blocked for the agent.",
  indirect: "Using a variable as the command name dodges the ssh block; write the command explicitly.",
};

/** Word lists of the simple commands in `cmd`, splitting on `; & | ( ) \`` and newlines outside quotes. */
function commandWords(cmd: string): string[][] {
  const out: string[][] = [[]];
  let cur = "", has = false, quote: string | null = null;
  const endTok = () => {
    if (has) out[out.length - 1].push(cur);
    cur = "";
    has = false;
  };
  const endCmd = () => {
    endTok();
    if (out[out.length - 1].length) out.push([]);
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"') cur += cmd[++i] ?? "";
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === "\\") {
      cur += cmd[++i] ?? ""; // `\ssh` runs ssh all the same
      has = true;
    } else if (c === "\n") endCmd();
    else if (/\s/.test(c)) endTok();
    else if (";&|()`".includes(c)) endCmd();
    else {
      cur += c;
      has = true;
    }
  }
  endCmd();
  return out.filter((w) => w.length);
}

const scan = (cmd: string, depth: number) => {
  for (const w of commandWords(cmd)) {
    const why = blockedWords(w, depth);
    if (why) return why;
  }
  return null;
};

/** Reason one simple command (as words) is off-limits for the agent, or null. */
function blockedWords(w: string[], depth = 0): string | null {
  if (depth > 5) return null;
  for (const t of w) {
    const k = t.search(/\$\(|`/); // an expansion inside double quotes still runs
    const why = k >= 0 && scan(t.slice(k + (t[k] === "`" ? 1 : 2)), depth + 1);
    if (why) return why;
  }
  let i = 0;
  for (;;) {
    while (i < w.length && (KEYWORDS.has(w[i]) || /^[A-Za-z_]\w*=/.test(w[i]))) i++;
    const wrap = w[i] !== undefined && Object.hasOwn(WRAPPERS, path.basename(w[i])) ? path.basename(w[i]) : null;
    if (!wrap) break;
    i++;
    while (w[i]?.startsWith("-")) i += WRAPPERS[wrap].includes(w[i]) ? 2 : 1;
    if (wrap === "timeout") i++; // the duration
  }
  const prog = w[i];
  if (!prog) return null;
  if (/^\$\{?\w+\}?$/.test(prog)) return WHY.indirect;
  const bin = path.basename(prog).toLowerCase();
  const args = w.slice(i + 1);
  if (SSH_BINS.has(bin)) return WHY.ssh;
  if (bin === "ssh-keygen" && args.some((a) => /^-[a-zA-Z]*y/.test(a))) return WHY.key; // derives the public key from a private one
  if (DEBUGGERS.has(bin) && (bin === "gcore" || args.some((a) => /^-[a-zA-Z]*p\d*$/.test(a) || /^--pid/.test(a) || /^\d+$/.test(a) || /attach/.test(a)))) return WHY.ptrace;
  const code = args.findIndex((a) => /^-[a-zA-Z]*[ce]$/.test(a));
  if (SHELLS.has(bin) && code >= 0 && args[code + 1]) return scan(args[code + 1], depth + 1);
  if (bin === "git" && args.some((a) => /core\.ssh/i.test(a))) return WHY.ssh; // `-c core.sshCommand=…` is ssh by another name
  // rsync runs ssh for `-e`/`--rsh` and for any `host:path` operand; plain local copies are fine.
  if (bin === "rsync" && args.some((a) => /^-[a-zA-Z]*e/.test(a) || abbrev(a, "--rsh") || (!/^[-/.]/.test(a) && /^(?:[\w.-]+@)?[\w.-]+:(?!\/\/)/.test(a)))) return WHY.ssh;
  if (args.some((a) => EXEC_CALL.test(a) && SSH_WORD.test(a))) return WHY.ssh;
  if (bin === "eval") return scan(args.join(" "), depth + 1);
  const exec = bin === "find" ? args.findIndex((a) => /^-(exec|execdir|ok|okdir)$/.test(a)) : -1;
  return exec >= 0 ? blockedWords(args.slice(exec + 1), depth + 1) : null;
}

const HOME = os.homedir();

/** Quotes and backslashes dropped, `~`/`$HOME` expanded, `//`, `/./` and `x/..` collapsed: what a path really names. */
function flatten(s: string): string {
  let t = s.replace(/['"\\]/g, "").replace(/(^|[\s=:(])(?:~|\$HOME|\$\{HOME\})(?=\/|\s|$)/g, (_, pre) => pre + HOME);
  t = t.replace(/\/{2,}/g, "/");
  for (let prev = ""; prev !== t; ) {
    prev = t;
    t = t.replace(/\/\.(?=\/|\s|$)/g, "").replace(/\/(?!\.\.(?:\/|\s|$))[^/\s]+\/\.\.(?=\/|\s|$)/g, "");
  }
  return t;
}

const API = /\/api\/ssh(?![\w-])/i;
const PROC = /\/proc\/(?:\S*\/)?(?:mem|environ|maps)(?![\w.-])/;
// ptrace as a syscall / constant / yama switch, not the word in a `grep -rn ptrace src`.
const PTRACE = /\bptrace\s*\(|PTRACE_[A-Z]+|process_vm_(?:read|write)v|(?:>|\btee\b|\bsysctl\b)[^\n]*ptrace_scope|ptrace_scope\s*=/;
const SSH_WORD = /\b(?:ssh|scp|sftp|sshpass)\b/;
// A program-launching call in the same line as an ssh word: `os.system('ssh h')`, `execSync("ssh h")`.
const EXEC_CALL = /\bos\.(?:system|popen|exec\w*)\s*\(|\bsubprocess\.\w+\s*\(|\bPopen\s*\(|\b(?:execSync|execFileSync|spawnSync|spawn|exec|execFile|execv\w*|popen|system|shell_exec|passthru|proc_open)\s*\(/;
const DECODER = /\b(?:base64|basenc|xxd|openssl\s+enc)\b/;
const SHELL_SINK = /\|\s*(?:(?:sudo|env|exec|command)\s+)*(?:\S*\/)?(?:ba|z|da|k|c)?sh\b|\beval\b|\bsource\b/;

// The ssh module's own folders inside the environment: the vault (os/data/ssh) and the temp key files (.state/os/ssh).
// The absolute ones are set at register; the names below also catch them relative to wherever the agent runs.
let guardedDirs: string[] = [];
/** Windows paths ignore case: there the comparison is done in lower case. */
let caseless = false;
export function guardDirs(dirs: string[], platform: NodeJS.Platform = process.platform): void {
  caseless = platform === "win32";
  guardedDirs = dirs.flatMap((d) => {
    if (!caseless) return [path.resolve(d)];
    // Forward slashes, lower case, and Git Bash's spelling of the drive (C:\x is also /c/x).
    const abs = (d.startsWith("/") ? d : path.win32.resolve(d)).replace(/\\/g, "/").toLowerCase();
    const drive = /^([a-z]):\//.exec(abs);
    return drive ? [abs, `/${drive[1]}/${abs.slice(3)}`] : [abs];
  });
}
const MODULE_DIRS = /(?:^|[/\s'"=])(?:os\/data|\.state\/os)\/ssh(?:[/\s'"]|$)/;
const MODULE_PARENT = /(?:^|[/\s'"=])(?:os\/data|\.state\/os)(?:[/\s'"]|$)/;

/** The ssh module's folders (vault, run keys), reached by name or by a glob; `tool` also refuses their parents as roots to search. */
function touchesDataDir(s: string, tool = false): boolean {
  const slashed = s.replace(/\\/g, "/");
  const norm = caseless ? slashed.toLowerCase() : slashed;
  if (MODULE_DIRS.test(norm)) return true;
  if (/(?:os\/data|\.state\/os)\/[^/\s]*[*?[{]/.test(norm)) return true; // a glob over the modules' folders
  if (MODULE_PARENT.test(norm) && /\bssh\b/.test(norm)) return true; // `cd os/data && cat ssh/vault/vault.json`
  for (const d of guardedDirs) {
    if (norm.includes(d)) return true;
    if (tool && norm.startsWith("/") && (d === norm.replace(/\/+$/, "") || d.startsWith(norm.replace(/\/+$/, "") + "/"))) return true;
  }
  return tool && /(?:^|\/)(?:os(?:\/data)?|\.state(?:\/os)?)\/?$/.test(norm);
}

/** `.ssh/<name>` where name is a private key (or a glob that could be one). */
function privateKeyIn(s: string): boolean {
  for (const m of s.matchAll(/\.ssh\/([^\s/;|&<>]+)/g)) {
    const name = m[1];
    if (/[*?[]/.test(name) || (/^id_/.test(name) && !name.endsWith(".pub")) || /\.(pem|key)$/.test(name)) return true;
  }
  return false;
}

/** A command that mentions `.ssh` and also names a private key, or a bare glob that could match one (`cd ~/.ssh && cat id_*`). */
function sshDirKey(flat: string): boolean {
  if (!/\.ssh/.test(flat)) return false;
  for (const m of flat.matchAll(/(?:^|[\s/=:])(id_[^\s;|&<>]*)/g)) if (!m[1].endsWith(".pub")) return true;
  return flat.split(/[\s;|&<>]+/).some((w) => !w.includes("/") && /[*?[]/.test(w) && globHitsSensitive(w));
}

function blockedBash(command: string): string | null {
  const flat = flatten(command);
  for (const s of [command, flat]) {
    if (touchesDataDir(s)) return WHY.vault;
    if (API.test(s)) return WHY.api;
    if (PROC.test(s)) return WHY.proc;
    if (PTRACE.test(s)) return WHY.ptrace;
  }
  // `/api/s%73h` or `/api/$'\x73'sh` reach the vault API without ever spelling it.
  if (/\/api\b/i.test(flat) && (/%(?:2[ef]|[4-7][0-9a-f])/i.test(command) || /\$'/.test(command))) return WHY.api;
  if (flat.split(/\s+/).some((w) => w.includes("/proc/") && /[*?[]/.test(w) && globHitsSensitive(w))) return WHY.proc;
  if (privateKeyIn(flat) || sshDirKey(flat)) return WHY.key;
  if (/SSH_AUTH_SOCK|SSH_ASKPASS|\bGIT_SSH(?:_COMMAND)?\s*=|core\.sshcommand/i.test(command)) return WHY.ssh;
  if (DECODER.test(command) && SHELL_SINK.test(command)) return WHY.ssh; // decode-and-execute hides whatever it runs
  if (command.split("\n").some((l) => EXEC_CALL.test(l) && SSH_WORD.test(l))) return WHY.ssh;
  return scan(command, 0);
}

function blockedPaths(values: unknown[], tool: string): string | null {
  for (const raw of values) {
    if (typeof raw !== "string" || !raw) continue;
    const norm = path.posix.normalize(flatten(raw));
    if (touchesDataDir(norm, true)) return WHY.vault;
    if (privateKeyIn(norm) || ((tool === "Grep" || tool === "Glob") && /(^|\/)\.ssh\/?$/.test(norm))) return WHY.key;
    if (PROC.test(norm)) return WHY.proc;
  }
  return null;
}

const joinPath = (dir: unknown, rest: unknown) => (typeof dir === "string" && typeof rest === "string" ? `${dir}/${rest}` : null);

/** Spanish reason this tool call must not run, or null. Looks only at the fields that can reach credentials. */
export function blockedToolUse(toolName: string, input: unknown): string | null {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  switch (toolName) {
    case "Bash":
      return typeof i.command === "string" ? blockedBash(i.command) : null;
    case "Read":
    case "Edit":
    case "Write":
    case "MultiEdit":
      return blockedPaths([i.file_path], toolName);
    case "NotebookEdit":
      return blockedPaths([i.notebook_path], toolName);
    case "Grep": // `pattern` is a regex, not a path; `glob` narrows the search under `path`
      return blockedPaths([i.path, i.glob, joinPath(i.path, i.glob)], toolName);
    case "Glob":
      return blockedPaths([i.path, i.pattern, joinPath(i.path, i.pattern)], toolName);
    default:
      return null;
  }
}
