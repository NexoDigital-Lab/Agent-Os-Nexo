// A copy of agent-os-nexo's apps/os/host/server/redact.ts (the CLI has no dependencies, and must not import the app):
// keep the two in step — test/memory.test.ts runs the same cases against both.
const REDACTED = "[redacted]";
// A name that smells like a secret followed by `=`/`: `; the value runs to the end of the line so quoted values with spaces go too.
// `:` needs whitespace (or a JSON quote) after it so `api-server:8080` and `image: myapi:latest` survive.
const SECRET_NAME = String.raw`[\w-]*(?:secret|pass|pwd|token|api|private|access|key)[\w-]*`;
const SCRUBBERS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
  [/(Authorization["']?\s*[:=]\s*(?:Basic|Bearer|Token)\s+)\S+/gi, `$1${REDACTED}`],
  [new RegExp(String.raw`(\b${SECRET_NAME}["']?\s*(?:=\s*|:\s+|:(?=["']))).*$`, "gim"), `$1${REDACTED}`],
  [/(--password(?:=|\s+))\S+/gi, `$1${REDACTED}`],
  [/(\bmysql(?:dump)?[ \t](?:\S+[ \t])*?-p)\S+/g, `$1${REDACTED}`], // `-pSECRET` is only a password after mysql
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_\w{20,}|\bsk-[\w-]{16,}|\b[sr]k_live_\w+|\bxox[abpr]-[\w-]+|\bglpat-[\w-]{10,}|\bAIza[\w-]{30,}/g, REDACTED],
  [/Bearer\s+\S+/g, `Bearer ${REDACTED}`],
  [/AKIA[0-9A-Z]{16}/g, REDACTED],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, REDACTED],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[\w.~-]{20,}@/gi, `$1${REDACTED}@`], // token-only userinfo; a short `git@` is just a user name
];

/** Masks what looks like a secret in text that is about to reach Claude. Best effort, on top of the read-only rules. */
export function redact(text: string): string {
  return SCRUBBERS.reduce((t, [re, to]) => t.replace(re, to), text);
}
