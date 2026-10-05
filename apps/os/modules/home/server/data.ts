// File-based state behind Home, adapted from ECC's agentic-os skill (MIT, affaan-m/ECC): goals and an inbox
// (os/data/home, the user's), plus an append-only daily log and per-day cost ledger of agent-os turns
// (.state/os/home, regenerable history). No database.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface HomeDirs {
  data: string;
  state: string;
}

let dirs: HomeDirs = { data: "", state: "" };

export function initData(d: HomeDirs): void {
  dirs = d;
  mkdirSync(d.data, { recursive: true });
  mkdirSync(join(d.state, "daily-logs"), { recursive: true });
}

const logs = () => join(dirs.state, "daily-logs");
const inbox = () => join(dirs.data, "inbox.md");
const goals = () => join(dirs.data, "goals.md");

const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local time
const now = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

export interface TurnLog {
  project: string;
  prompt: string;
  skills: string[];
  cost: number;
  turns: number;
  ok: boolean;
}

/** Appends one line to today's log and ledger; past days are never rewritten. */
export function logSession(entry: TurnLog): void {
  const file = join(logs(), `${today()}.md`);
  if (!existsSync(file)) writeFileSync(file, `# ${today()}\n\n`);
  const task = entry.prompt.replace(/\s+/g, " ").slice(0, 120);
  const skills = entry.skills.length ? ` [${entry.skills.join(", ")}]` : "";
  appendFileSync(file, `- ${now()} · **${entry.project || "—"}** · ${entry.ok ? "ok" : "error"} · $${entry.cost.toFixed(3)} · ${entry.turns} turns — ${task}${skills}\n`);

  const ledger = join(logs(), `${today()}-costs.json`);
  const rows = existsSync(ledger) ? (JSON.parse(readFileSync(ledger, "utf8")) as unknown[]) : [];
  rows.push({ at: new Date().toISOString(), ...entry, prompt: task });
  writeFileSync(ledger, JSON.stringify(rows, null, 2));
}

export function todayCost(): number {
  const ledger = join(logs(), `${today()}-costs.json`);
  if (!existsSync(ledger)) return 0;
  return (JSON.parse(readFileSync(ledger, "utf8")) as Array<{ cost: number }>).reduce((s, r) => s + r.cost, 0);
}

export type Doc = "inbox" | "goals" | "log";

export function readDoc(which: Doc): string {
  const file = which === "inbox" ? inbox() : which === "goals" ? goals() : join(logs(), `${today()}.md`);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

export function writeDoc(which: "inbox" | "goals", text: string): void {
  writeFileSync(which === "inbox" ? inbox() : goals(), text);
}

export function addToInbox(text: string, project: string | null): void {
  if (!existsSync(inbox())) writeFileSync(inbox(), "# Inbox\n\n");
  appendFileSync(inbox(), `- [ ] ${today()} ${project ? `**${project}** — ` : ""}${text.replace(/\n/g, " ")}\n`);
}
