// Saved SSH accesses, encrypted at rest (scrypt → AES-256-GCM). The master password is never stored: the derived key
// lives only in this process's memory, so after every server start the user unlocks again. Secrets leave this module
// only through `get()`, which the session code uses to connect — no route returns them.
import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual, type BinaryLike } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { httpError } from "../../../host/server/http.ts";
import type { SshHost, SshHostInput, VaultState } from "./types.ts";

// The vault lives in os/data/ssh/vault and the temp key files in .state/os/ssh/run (see session.ts); the module sets
// both at register. NEXO_SSH_DIR lets tests keep a vault (and its run dir) apart from the real one.
const TEST_DIR = process.env.NEXO_SSH_DIR;
export let VAULT_DIR = TEST_DIR ?? "";
export let RUN_DIR = TEST_DIR ? path.join(TEST_DIR, "run") : "";

const N = 2 ** 17, R = 8, P = 1;
const scryptAsync = promisify(scrypt) as (pw: BinaryLike, salt: BinaryLike, len: number, opts: object) => Promise<Buffer>;
// scrypt needs 128*N*r bytes; Node's default cap is 32 MiB, so raise it (x2 for headroom).
const derive = (pw: string, salt: Buffer, n = N, r = R, p = P) => scryptAsync(pw, salt, 32, { N: n, r, p, maxmem: 128 * n * r * 2 });

/** A host as stored: the public fields plus the secrets. */
export type StoredHost = Omit<SshHost, "hasSecret" | "hasPassphrase"> & { secret?: string; passphrase?: string };

type VaultFile = { v: 1; kdf: "scrypt"; N: number; r: number; p: number; salt: string; iv: string; tag: string; ct: string };

const MAX_TRIES = 5, COOLDOWN_MS = 30_000;

export const toPublic = ({ secret, passphrase, ...h }: StoredHost): SshHost => ({ ...h, hasSecret: !!secret, hasPassphrase: !!passphrase });

export class Vault {
  private key: Buffer | null = null;
  private salt: Buffer | null = null;
  private stored: StoredHost[] = [];
  private tokens = new Set<string>();
  private fails = 0;
  private coolUntil = 0;
  private queue: Promise<unknown> = Promise.resolve(); // unlock attempts run one at a time (see unlock)
  private readonly dir: string;
  private readonly file: string;

  constructor(dir: string) {
    this.dir = dir;
    this.file = path.join(dir, "vault.json");
  }

  state(): VaultState {
    return !existsSync(this.file) ? "setup" : this.key ? "unlocked" : "locked";
  }

  async setup(password: string) {
    if (this.state() !== "setup") throw httpError(409, "The vault is already set up");
    this.salt = randomBytes(16);
    this.key = await derive(password, this.salt);
    this.stored = [];
    this.save();
  }

  /**
   * Throws 401 on a wrong password; after 5 in a row, 429 until the cooldown passes (the agent's Bash could brute-force).
   * Attempts are serialized and the failure is counted before the (slow) derive, so a burst of parallel requests
   * cannot get more than MAX_TRIES guesses.
   */
  unlock(password: string): Promise<void> {
    const attempt = this.queue.then(() => this.tryUnlock(password));
    this.queue = attempt.catch(() => {});
    return attempt;
  }

  private async tryUnlock(password: string) {
    if (this.state() === "setup") throw httpError(409, "Set up the vault first");
    const wait = this.coolUntil - Date.now();
    if (wait > 0) throw httpError(429, `Too many attempts: wait ${Math.ceil(wait / 1000)} s`);
    let f: VaultFile;
    try {
      f = JSON.parse(readFileSync(this.file, "utf8"));
      if (f.v !== 1 || f.kdf !== "scrypt" || !Number.isInteger(Math.log2(f.N)) || f.N < 2 ** 14 || f.N > 2 ** 18 || f.r < 1 || f.r > 8 || f.p < 1 || f.p > 2) throw 0;
    } catch {
      throw httpError(500, "The vault file is damaged");
    }
    if (++this.fails >= MAX_TRIES) {
      this.fails = 0;
      this.coolUntil = Date.now() + COOLDOWN_MS;
    }
    const salt = Buffer.from(f.salt, "base64");
    const key = await derive(password, salt, f.N, f.r, f.p);
    try {
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(f.iv, "base64"));
      d.setAuthTag(Buffer.from(f.tag, "base64"));
      const plain = Buffer.concat([d.update(Buffer.from(f.ct, "base64")), d.final()]);
      this.stored = (JSON.parse(plain.toString("utf8")) as { hosts: StoredHost[] }).hosts;
    } catch {
      throw httpError(401, "Wrong password");
    }
    this.fails = 0;
    this.coolUntil = 0;
    this.key = key;
    this.salt = salt;
  }

  /** Wipes the key and the hosts from memory and drops every UI token. Open sessions keep running. */
  lock() {
    this.key = this.salt = null;
    this.stored = [];
    this.tokens.clear();
  }

  issueToken(): string {
    const t = randomBytes(32).toString("hex");
    this.tokens.add(t);
    return t;
  }

  /** Constant-time membership test: no early exit on the first matching byte or token. */
  validToken(candidate: string | undefined): boolean {
    if (!candidate) return false;
    const c = Buffer.from(candidate);
    let ok = false;
    for (const t of this.tokens) {
      const b = Buffer.from(t);
      if (b.length === c.length && timingSafeEqual(b, c)) ok = true;
    }
    return ok;
  }

  list(): SshHost[] {
    return this.unlocked().map(toPublic);
  }

  /** The host with its secrets — for opening a connection, never for a response. */
  get(id: string): StoredHost | undefined {
    return this.unlocked().find((h) => h.id === id);
  }

  add(input: SshHostInput): SshHost {
    const hosts = this.unlocked();
    const h: StoredHost = { ...this.merge(input), id: randomBytes(4).toString("hex") };
    hosts.push(h);
    this.save();
    return toPublic(h);
  }

  update(id: string, input: SshHostInput): SshHost | null {
    const hosts = this.unlocked();
    const i = hosts.findIndex((h) => h.id === id);
    if (i < 0) return null;
    hosts[i] = { ...this.merge(input, hosts[i]), id };
    this.save();
    return toPublic(hosts[i]);
  }

  remove(id: string): boolean {
    const hosts = this.unlocked();
    const i = hosts.findIndex((h) => h.id === id);
    if (i < 0) return false;
    hosts.splice(i, 1);
    this.save();
    return true;
  }

  /** `secret`/`passphrase`: omitted = keep, "" = clear. Changing the auth kind drops the old secret (a key is not a password). */
  private merge({ secret, passphrase, ...pub }: SshHostInput, prev?: StoredHost): Omit<StoredHost, "id"> {
    const kept = (v: string | undefined, old: string | undefined) => (v === undefined ? (prev && prev.auth === pub.auth ? old : undefined) : v || undefined);
    return { ...pub, secret: pub.auth === "local" ? undefined : kept(secret, prev?.secret), passphrase: pub.auth === "key" ? kept(passphrase, prev?.passphrase) : undefined };
  }

  private unlocked(): StoredHost[] {
    if (!this.key) throw httpError(401, "The SSH vault is locked");
    return this.stored;
  }

  /** Fresh IV every time (GCM breaks if one repeats under the same key); write to a temp file and rename. */
  private save() {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key!, iv);
    const ct = Buffer.concat([c.update(JSON.stringify({ hosts: this.stored }), "utf8"), c.final()]);
    const f: VaultFile = { v: 1, kdf: "scrypt", N, r: R, p: P, salt: this.salt!.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") };
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(f), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

export let vault = new Vault(VAULT_DIR);

/** Where the vault and the temp key files live (os/data/ssh/vault, .state/os/ssh/run). Ignored under NEXO_SSH_DIR. */
export function initVault(vaultDir: string, runDir: string): void {
  if (TEST_DIR) return;
  VAULT_DIR = vaultDir;
  RUN_DIR = runDir;
  vault = new Vault(vaultDir);
}
