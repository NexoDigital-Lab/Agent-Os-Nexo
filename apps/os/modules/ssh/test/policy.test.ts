import assert from "node:assert/strict";
import { test } from "node:test";
import { blockedToolUse, guardDirs, isReadOnly, redact } from "../server/policy.ts";

// The absolute folders the module guards at register (vault and run keys elsewhere, as a custom setup could put them).
guardDirs(["/srv/vault-dir", "/srv/run-dir"]);

test("on Windows the module's folders are guarded whatever the case, slashes or drive spelling", () => {
  try {
    guardDirs(["C:\\Users\\Me\\env\\os\\data\\ssh", "/srv/run-dir"], "win32");
    for (const command of [
      "type C:\\Users\\Me\\env\\os\\data\\ssh\\vault\\vault.json",
      "type c:\\users\\me\\env\\OS\\DATA\\SSH\\vault\\vault.json",
      "cat /c/Users/Me/env/os/data/ssh/vault/vault.json",
      "cat C:/USERS/me/env/os/data/ssh/vault/vault.json",
      "cat /SRV/RUN-DIR/key",
    ]) assert.ok(blockedToolUse("Bash", { command }), command);
    assert.equal(blockedToolUse("Bash", { command: "type C:\\Users\\Me\\env\\notes.txt" }), null);
  } finally {
    guardDirs(["/srv/vault-dir", "/srv/run-dir"]);
  }
});

test("elsewhere the folders are resolved: a trailing slash or .. in the configured path still guards them", () => {
  try {
    guardDirs(["/srv/x/../vault-dir/", "/srv/run-dir"], "linux");
    assert.ok(blockedToolUse("Bash", { command: "cat /srv/vault-dir/vault.json" }));
    assert.equal(blockedToolUse("Bash", { command: "cat /SRV/VAULT-DIR/vault.json" }), null, "Linux paths keep their case");
  } finally {
    guardDirs(["/srv/vault-dir", "/srv/run-dir"]);
  }
});

test("isReadOnly allows plain inspection, pipes included", () => {
  for (const cmd of [
    "ls -la /var/log",
    "uname -a",
    "tail -f /var/log/syslog | grep error",
    "cat /etc/os-release",
    "grep -i 'a|b' /var/log/auth.log | sort | uniq -c",
    "ps aux | grep nginx",
    "ps -ef",
    "find /var/log -name '*.log' -mtime -1",
    "df -h",
    "free -m",
    "journalctl -u nginx -n 50 --no-pager",
    "systemctl status nginx",
    "systemctl is-active docker",
    "docker ps -a",
    "docker logs --tail 100 web",
    "docker stats --no-stream",
    "docker compose ps",
    "git status",
    "git log --oneline -5",
    "git branch -a",
    "git remote -v",
    "sed -n '5,10p' /var/log/app.log",
    "sed -n '/error/p' app.log",
    "awk '{print $1}' access.log",
    "awk -F: '{print $1}' /etc/passwd",
    "ip addr",
    "ip -br a",
    "ip route show",
    "top -bn1",
    "nginx -t",
    "ls *.log",
    "head -n 20 /var/log/*.log",
  ])
    assert.equal(isReadOnly(cmd), true, cmd);
});

test("isReadOnly rejects anything that changes things or chains", () => {
  for (const cmd of [
    "ls; rm -rf /",
    "ls && echo x",
    "ls || true",
    "ls > out.txt",
    "ls >> out.txt",
    "cat <(ls)",
    "cat < /etc/passwd",
    "grep x $(whoami)",
    "echo `id`",
    "ls &",
    "ls\nrm x",
    "ls\tfoo",
    "ls !!",
    "find . -delete",
    "find . -exec rm {} +",
    "find . -fprint out",
    "sed -i s/a/b/ f",
    "sed -n 'w out' f",
    "sed 's/a/b/' f",
    "sed -n '1e id' f",
    "awk 'BEGIN{system(\"id\")}'",
    "awk '{print > \"x\"}' f",
    "docker rm web",
    "docker exec web ls",
    "docker stats",
    "docker compose up",
    "systemctl restart nginx",
    "systemctl -H other status x",
    "git push",
    "git commit -m x",
    "git branch -D x",
    "git branch newname",
    "git log --output=/tmp/x",
    "ip link set eth0 down",
    "ip addr add 1.2.3.4 dev eth0",
    "journalctl --vacuum-size=1M",
    "top",
    "less file",
    "env",
    "printenv",
    "printenv PATH",
    "rm file",
    "touch x",
    "tee x",
    "sort -o out in",
    "date -s tomorrow",
    "ps eww",
    "grep -r password .",
    "grep -rn x /etc",
    "rg --hidden x",
    "FOO=1 ls",
    "/bin/ls",
    "ls \"$HOME\"",
    "",
    "| ls",
    "ls |",
  ])
    assert.equal(isReadOnly(cmd), false, JSON.stringify(cmd));
});

test("isReadOnly rejects sensitive paths even when disguised", () => {
  for (const cmd of [
    "cat .env",
    "cat app/.env.production",
    "cat /etc/shadow",
    "cat /etc/sh''adow",
    "cat .e\"\"nv",
    "cat .e*",
    "cat /etc/shad?w",
    "cat ~/.ssh/id_rsa",
    "cat ~/.ssh/id_ed25519",
    "head server.pem",
    "tail tls.key",
    "cat ~/.pgpass",
    "cat ~/.netrc",
    "cat ~/.aws/credentials",
    "cat ~/.docker/config.json",
    "cat ~/.ssh/authorized_keys",
    "cat ~/.git-credentials",
    "cat ~/.npmrc",
    "cat /run/secrets/db",
    "cat /proc/1/environ",
    "cat /proc/*/environ",
    "grep x .env",
    "ls | cat .env",
    "cat *",
  ])
    assert.equal(isReadOnly(cmd), false, cmd);
  assert.equal(isReadOnly("ls .env"), false, "even listing it is refused: conservative");
});

test("redact masks keys, passwords, tokens and URL credentials", () => {
  const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\nAAAA\n-----END OPENSSH PRIVATE KEY-----";
  assert.equal(redact(`before\n${key}\nafter`), "before\n[redacted]\nafter");
  assert.equal(redact("-----BEGIN RSA PRIVATE KEY-----\ntruncated"), "[redacted]");
  assert.equal(redact("DB_PASSWORD=hunter2 ok"), "DB_PASSWORD=[redacted]", "masks to end of line");
  assert.match(redact("password: hunter2"), /password: \[redacted\]/);
  assert.doesNotMatch(redact('{"api_key": "abc123"}'), /abc123/);
  assert.doesNotMatch(redact("STRIPE_SECRET=sk_live_abc"), /sk_live/);
  assert.doesNotMatch(redact("Authorization: Bearer abc.def.ghi"), /abc\.def/);
  assert.equal(redact("key AKIAABCDEFGHIJKLMNOP end"), "key [redacted] end");
  assert.doesNotMatch(redact("t eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sgn_ture-x"), /eyJ/);
  assert.equal(redact("postgres://admin:s3cr3t@db:5432/app"), "postgres://[redacted]@db:5432/app");
  assert.equal(redact("https://github.com/a/b"), "https://github.com/a/b");
  assert.equal(redact("nothing to hide here"), "nothing to hide here");
});

const bash = (command: string) => blockedToolUse("Bash", { command });

test("blockedToolUse blocks direct ssh in every position", () => {
  for (const command of [
    "ssh user@h",
    "sudo scp a b:c",
    "echo ok && ssh h",
    "ls; ssh h",
    "ls | ssh h cat",
    "/usr/bin/ssh h",
    "FOO=1 ssh h",
    "sudo -u root ssh h",
    "env -i ssh h",
    "timeout 5 ssh h",
    "xargs -I{} ssh {} ls",
    "nohup ssh h &",
    "bash -c 'ssh h'",
    "sudo bash -c \"echo; ssh h\"",
    "eval ssh h",
    "echo $(ssh h hostname)",
    "echo \"$(ssh h hostname)\"",
    "echo `ssh h`",
    "s''sh h",
    "\\ssh h",
    "find . -exec ssh h {} \\;",
    "sftp h",
    "sshpass -p x ssh h",
    "ssh-add ~/.ssh/id_ed25519.pub",
    "ssh-agent bash",
    "ssh-keygen -y -f key",
    "python3 -c \"import os; os.system('ssh h')\"",
    "$S h",
    "{ ssh h; }",
  ])
    assert.ok(bash(command), command);
});

test("blockedToolUse leaves ordinary commands alone", () => {
  for (const command of [
    "git push",
    "git push origin main",
    "git clone ssh://git@github.com/a/b.git",
    "git clone git@github.com:a/b.git",
    "systemctl status ssh",
    "grep ssh /var/log/auth.log",
    "ps aux | grep ssh",
    "cat ~/.ssh/id_ed25519.pub",
    "cat ~/.ssh/config",
    "ls ~/.ssh",
    "ssh-keygen -t ed25519 -f /tmp/k",
    "node --import tsx --test server/ssh/policy.test.ts",
    "cat /home/a/Documents/agent-hub/os/server/ssh/vault.ts",
    "curl http://127.0.0.1:4747/api/tabs",
    "ls -la",
    "cat /proc/cpuinfo",
    "gdb ./prog",
  ])
    assert.equal(bash(command), null, command);
});

test("blockedToolUse blocks credentials, the vault API, and process snooping", () => {
  for (const command of [
    "curl http://127.0.0.1:4747/api/ssh/hosts",
    "curl -s localhost:4747/API/SSH/state",
    "cat ~/env/os/data/ssh/vault/vault.json",
    "cat ../../os/data/s''sh/vault/vault.json",
    "ls ~/env/.state/os/ssh/run",
    "cd ~/env/os/data && cat ssh/vault/vault.json",
    "cat ~/env/os/data/*/vault/vault.json",
    "cat /srv/vault-dir/vault.json",
    "cat ~/.ssh/id_ed25519",
    "cat '~/.ssh/id_rsa'",
    "cat ~/.ssh/id_\"ed25519\"",
    "cat ~/.ssh/*",
    "cat ~/.ssh/deploy.pem",
    "cat ~/.ssh/server.key",
    "cat /proc/123/environ",
    "cat /proc/self/mem",
    "strings /proc/9/maps",
    "gdb -p 123",
    "gdb -batch -ex 'attach 5'",
    "sudo strace -fp 99",
    "gcore 1",
    "echo 1 > /proc/sys/kernel/yama/ptrace_scope",
  ])
    assert.ok(bash(command), command);
});

test("blockedToolUse checks file tools by path", () => {
  const home = "/home/a";
  assert.ok(blockedToolUse("Read", { file_path: `${home}/.ssh/id_ed25519` }));
  assert.equal(blockedToolUse("Read", { file_path: `${home}/.ssh/id_ed25519.pub` }), null);
  assert.ok(blockedToolUse("Read", { file_path: `${home}/.ssh/key.pem` }));
  assert.ok(blockedToolUse("Read", { file_path: `${home}/env/os/data/ssh/vault/vault.json` }));
  assert.ok(blockedToolUse("Edit", { file_path: `${home}/env/.state/os/ssh/run/k-1/key` }));
  assert.ok(blockedToolUse("Write", { file_path: `${home}/env/os/data/x/../ssh/vault/vault.json` }));
  assert.ok(blockedToolUse("Grep", { pattern: "x", path: `${home}/env/os/data/ssh` }));
  assert.ok(blockedToolUse("Grep", { pattern: "BEGIN", path: `${home}/.ssh` }));
  assert.ok(blockedToolUse("Glob", { pattern: "os/data/*/vault/vault.json", path: `${home}/env` }));
  assert.equal(blockedToolUse("Glob", { pattern: "**/vault.json" }), null, "vault.json elsewhere is just a file name");
  assert.ok(blockedToolUse("Glob", { pattern: "*", path: `${home}/.ssh/*` }));
  assert.ok(blockedToolUse("NotebookEdit", { notebook_path: "/proc/1/environ" }));
  assert.ok(blockedToolUse("Read", { file_path: "/proc/1/environ" }));
  assert.equal(blockedToolUse("Read", { file_path: `${home}/Documents/agent-hub/os/server/ssh/vault.ts` }), null);
  assert.equal(blockedToolUse("Edit", { file_path: `${home}/proj/src/ssh/client.ts` }), null);
  assert.equal(blockedToolUse("Grep", { pattern: "ssh", path: `${home}/proj` }), null);
  assert.equal(blockedToolUse("WebFetch", { url: "http://127.0.0.1:4747/api/ssh/hosts" }), null, "only the listed fields are inspected");
  assert.equal(blockedToolUse("Bash", {}), null);
  assert.equal(blockedToolUse("Read", null), null);
});

// ── hardening round (security review) ───────────────────────────────────────────────────────────────────────────

const rejects = (cmds: string[]) => {
  for (const cmd of cmds) assert.equal(isReadOnly(cmd), false, cmd);
};
const allows = (cmds: string[]) => {
  for (const cmd of cmds) assert.equal(isReadOnly(cmd), true, cmd);
};

test("isReadOnly: ps only with allowlisted options (BSD `e` shows the environment)", () => {
  rejects(["ps ax e", "ps -ef e", "ps aux ewww", "ps axe", "ps -p 1 e", "ps -eo pid,environ", "ps -o env", "ps --format x", "ps -eo"]);
  allows(["ps", "ps aux", "ps ax", "ps -e", "ps -ef", "ps -eo pid,comm,%cpu", "ps -u root", "ps -p 1", "ps --sort=-%cpu -e", "ps -o pid,args -H"]);
});

test("isReadOnly: /proc secrets reached by normalizing paths", () => {
  rejects([
    "cat /proc/self/fd/../environ",
    "cat /proc/self/./environ",
    "cat /proc//1//environ",
    "cat /proc/self/task/1/environ",
    "cat /proc/1/task/1/mem",
    "cat /proc/self/maps",
    "cat /proc/self/fd/../m*",
    "cat /proc/self/envir?n",
    "cat ./x/../../proc/self/environ",
    "grep x /proc/1/environ",
  ]);
  allows(["cat /proc/cpuinfo", "cat /proc/meminfo", "grep -i environment /etc/os-release"]);
});

test("isReadOnly: option values and globs are checked for every program", () => {
  rejects([
    "date -f .en*",
    "date -f x",
    "date --file=x",
    "date --fil=x",
    "du --files0-from=.en*",
    "du --files0-from=list",
    "wc --files0-from=list",
    "sort --files0-from=list",
    "file -f x",
    "file -C",
    "file -bf x",
    "file --files-from x",
    "file .en*",
    "stat --file=x",
    "grep --file=.env x",
    "cat --file=x",
    "find . -files0-from list",
    "date --se=x",
    "ss -D out",
  ]);
  allows(["du -sh /var/*", "ls .e*", "wc -l *.log", "cut -f1 -d: /etc/passwd", "ls --file-type"]);
});

test("isReadOnly: git and sensitive names after `:` or without a leading slash", () => {
  rejects(["git show HEAD:.env", "git show :secrets.json", "git log -p -- .env", "git show HEAD:app/.env.local", "git show HEAD:a/.ssh/id_rsa", "git log --out=/tmp/x", "git diff --ext=1", "git log -O orders"]);
  rejects(["cat foo.env", "cat a//.env", "cat x/../.env"]);
  allows(["git show HEAD:README.md", "git log -p -- src/app.ts"]);
});

test("isReadOnly: rg is recursive by default, so it needs piped input or one explicit file", () => {
  rejects(["rg password", "rg password .", "rg password /etc", "rg password /etc/ ", "rg x a.log b.log", "rg --hidden x f.log", "rg -uu x f.log", "rg -g '*' x f.log", "rg --pre cat x f.log", "rg --files", "rg x *.log", "rg x ../f.log/.."]);
  allows(["ls | rg x", "cat f.log | rg -i error", "rg -n error app.log", "rg -e error -m 5 app.log", "ls | rg -e x"]);
});

test("isReadOnly: GNU long-option abbreviations and clusters of blacklisted options", () => {
  rejects([
    "grep --recurs x .",
    "grep --rec x .",
    "grep --dereference-r x .",
    "grep --directories=recurse x .",
    "grep --dir=recurse x .",
    "grep -d recurse x .",
    "journalctl --vacuum-t=1d",
    "journalctl --vac=1M",
    "journalctl --rot",
    "journalctl --flu",
    "journalctl --sync",
    "ss -K",
    "ss -tK",
    "ss --ki",
    "ss --kill",
    "systemctl --hos=x status y",
    "systemctl --mach=x status y",
    "systemctl -Hx status y",
    "sort --out=x f",
    "sort --compress-p=x f",
  ]);
  allows(["journalctl -u x --since today", "ss -tlnp", "grep --regexp=x f", "grep --ignore-case x f", "sort -rn f"]);
});

test("isReadOnly: # would comment out the end marker", () => {
  rejects(["ls #", "ls #foo", "ls '#x'", "ls | #", "cat x '#y'"]);
  allows(["ls a#b"]);
});

test("redact: names with secret-ish words, up to the end of the line", () => {
  for (const [line, leak] of [
    ["SECRET_KEY=abc123", "abc123"],
    ["STRIPE_SECRET_KEY=sk_test_zzz", "zzz"],
    ["DB_PASS=hunter2", "hunter2"],
    ["APP_KEY=base64:AbCdEf", "AbCdEf"],
    ["DATABASE_PASSWORD: s3cret value", "value"],
    ['MY_PRIVATE="two words here"', "words"],
    ["X_ACCESS=abcdef", "abcdef"],
    ['{"api_key":"qqq"}', "qqq"],
    ["x-api-key: zzz999", "zzz999"],
  ] as const)
    assert.doesNotMatch(redact(line), new RegExp(leak), line);
  assert.equal(redact("SECRET_KEY=abc"), "SECRET_KEY=[redacted]");
  assert.equal(redact("api-server:8080 up"), "api-server:8080 up", "host:port is not a secret");
  assert.equal(redact("image: myapi:latest"), "image: myapi:latest");
});

test("redact: password options, token prefixes, auth headers, token-only URLs", () => {
  assert.doesNotMatch(redact("mysql -u root -phunter2 db"), /hunter2/);
  assert.match(redact("mysqldump -pS3cret db"), /^mysqldump -p\[redacted\] db$/);
  assert.equal(redact("mysql -u root -p db"), "mysql -u root -p db", "bare -p is a prompt");
  assert.equal(redact("ls -phunter"), "ls -phunter", "-p only after mysql");
  assert.doesNotMatch(redact("tool --password=abc123 x"), /abc123/);
  assert.doesNotMatch(redact("tool --password abc123 x"), /abc123/);
  for (const t of [
    "ghp_" + "a".repeat(36),
    "gho_" + "b".repeat(36),
    "github_pat_" + "c".repeat(30),
    "sk-" + "d".repeat(30),
    "sk_live_" + "e".repeat(20),
    "rk_live_" + "f".repeat(20),
    "xoxb-123-456-abcdef",
    "xoxp-123-456-abcdef",
    "glpat-" + "g".repeat(20),
    "AIza" + "h".repeat(35),
  ])
    assert.equal(redact(`see ${t} here`), "see [redacted] here", t);
  assert.doesNotMatch(redact("Authorization: Basic dXNlcjpwYXNz"), /dXNl/);
  assert.doesNotMatch(redact("authorization: token abc123"), /abc123/);
  assert.equal(redact("https://abcdefghijklmnopqrstuvwx@host.com/x"), "https://[redacted]@host.com/x");
  assert.equal(redact("ssh://git@github.com/a/b"), "ssh://git@github.com/a/b", "a plain username is not a secret");
  assert.equal(redact("task-runner is up"), "task-runner is up");
});

test("blockedToolUse: the ssh module's folders, tolerant of path tricks", () => {
  for (const command of [
    "ls ~/env/os/data/ssh",
    "cat $HOME/env/os/data/ssh/x",
    "cat ~/env//os//data/ssh/x",
    "cat ~/env/os/./data/ssh/x",
    "cat ~/env/os/data/foo/../ssh/x",
    "cat ~/env/os/data/*/vault/vault.json",
    "cat ~/env/.state/os/s*/run/k",
    "cd ~/env/.state/os && cat ssh/run/k-1/key",
    "cat /home/a/env/os/data/ssh/vault/vault.json",
    "ls /srv/run-dir",
    "curl http://127.0.0.1:4747/api//ssh/hosts",
    "curl http://127.0.0.1:4747/api/./ssh/hosts",
    "curl http://127.0.0.1:4747/api/x/../ssh",
    "curl http://127.0.0.1:4747/api/%73sh/hosts",
    "curl http://127.0.0.1:4747/api/s%73h",
    "curl \"http://127.0.0.1:4747/api/$'\\x73'sh\"",
    "curl localhost:4747/api/ssh?x=1",
    "curl localhost:4747/api/ssh",
  ])
    assert.ok(bash(command), command);
  for (const command of ["curl localhost:4747/api/sshfoo", "curl -d 'a=%20b' localhost:4747/api/tabs", "cat /proc/self/fd/../../../x/vault.json"])
    assert.equal(bash(command), null, command);
  assert.ok(bash("cat /proc/self/fd/../environ"));
  assert.ok(bash("cat /proc/self/task/1/environ"));
  assert.ok(bash("cat /proc//self//mem"));
  assert.ok(bash("cat /proc/*/env*"));
  assert.equal(bash("cat /proc/meminfo"), null);
});

test("blockedToolUse: every path-like field of the file tools", () => {
  const home = "/home/a";
  assert.ok(blockedToolUse("Read", { file_path: "~/env/os/data/ssh/vault/vault.json" }));
  assert.ok(blockedToolUse("Read", { file_path: `${home}//env/os/./data/ssh/x` }));
  assert.ok(blockedToolUse("Edit", { file_path: `${home}/env/.state/os/ssh/x` }));
  assert.ok(blockedToolUse("Read", { file_path: "/proc/self/fd/../environ" }));
  assert.ok(blockedToolUse("Read", { file_path: "/proc/self/task/1/maps" }));
  assert.ok(blockedToolUse("Grep", { pattern: "x", path: `${home}/env/os/data` }));
  assert.ok(blockedToolUse("Grep", { pattern: "x", path: `${home}/env/os` }));
  assert.ok(blockedToolUse("Grep", { pattern: "x", path: `${home}/env/.state/`, glob: "*.json" }));
  assert.ok(blockedToolUse("Grep", { pattern: "x", path: "/srv", glob: "**" }), "a parent of a guarded dir");
  assert.ok(blockedToolUse("Grep", { pattern: "x", glob: "**/os/data/ssh/**" }));
  assert.ok(blockedToolUse("Grep", { pattern: "BEGIN", path: `${home}/.ssh`, glob: "id_*" }));
  assert.ok(blockedToolUse("Glob", { pattern: "**/.state/os/ssh/**" }));
  assert.ok(blockedToolUse("Glob", { pattern: "**/ssh/*", path: `${home}/env/os/data` }));
  assert.ok(blockedToolUse("Glob", { pattern: "*/vault.json", path: `${home}/env/os/data/ssh` }));
  assert.ok(blockedToolUse("MultiEdit", { file_path: `${home}/env/os/data/ssh/vault/vault.json` }));
  assert.equal(blockedToolUse("Read", { file_path: `${home}/env/os/data/notes/x.md` }), null, "other modules' data is not the vault");
  assert.equal(blockedToolUse("Grep", { pattern: "x", path: `${home}/proj`, glob: "*.ts" }), null);
  assert.equal(blockedToolUse("Glob", { pattern: "**/*.ts", path: `${home}/proj` }), null);
  assert.equal(blockedToolUse("Read", { file_path: "/proc/meminfo" }), null);
});

test("blockedToolUse: private keys next to .ssh", () => {
  for (const command of [
    "cd ~/.ssh && cat id_ed25519",
    "cd ~/.ssh; cat id_*",
    "cd ~/.ssh && base64 id_rsa",
    "cat ~/.ssh/id_rsa ~/.ssh/id_rsa.pub",
    "cp ~/.ssh/id_ed25519 /tmp/k",
    "cd ~/.ssh && cat i*",
    "cd ~/.ssh && cat *",
    "tar c ~/.ssh/id_ed25519",
  ])
    assert.ok(bash(command), command);
  for (const command of ["cat ~/.ssh/id_ed25519.pub", "ls ~/.ssh", "cat ~/.ssh/known_hosts", "cd ~/.ssh && cat id_ed25519.pub", "grep id_rsa notes.md"])
    assert.equal(bash(command), null, command);
});

test("blockedToolUse: more ways to reach ssh", () => {
  for (const command of [
    "command ssh h",
    "env ssh h",
    "env -i FOO=1 ssh h",
    "\\ssh h",
    "/usr/bin/ssh h",
    "/usr/bin//ssh h",
    "'s'sh h",
    "s''sh h",
    "\"s\"sh h",
    "ss\\h h",
    "git -c core.sshCommand='ssh -i k' fetch",
    "git -c core.sshcommand=x pull",
    "git config core.sshCommand ssh",
    "GIT_SSH_COMMAND='ssh -i k' git fetch",
    "export GIT_SSH_COMMAND=ssh",
    "env GIT_SSH=/usr/bin/ssh git fetch",
    "rsync -e ssh a h:b",
    "rsync -av -e 'ssh -i k' a b",
    "rsync -ave ssh a b",
    "rsync --rsh=ssh a b",
    "rsync -av a user@h:/tmp/",
    "rsync -av h:/tmp/a .",
    "nc -U $SSH_AUTH_SOCK",
    "nc -U \"${SSH_AUTH_SOCK}\"",
    "socat - UNIX-CONNECT:$SSH_AUTH_SOCK",
    "echo c3No | base64 -d | sh",
    "echo c3No | base64 -d | bash -s",
    "base64 -d x | sudo sh",
    "xxd -r -p x | zsh",
    "eval \"$(echo c3No | base64 -d)\"",
    "node -e \"require('child_process').execSync('ssh h')\"",
    "python3 -c \"import subprocess; subprocess.run(['x']); os.system('ssh h')\"",
    "python3 - <<EOF\nimport os\nos.system('ssh h')\nEOF",
    "perl -e 'system(\"ssh h\")'",
  ])
    assert.ok(bash(command), command);
});

test("blockedToolUse: no false positives on everyday commands", () => {
  for (const command of [
    "grep -rn ptrace src",
    "grep ptrace_scope README.md",
    "cat vault.json",
    "cat server/ssh/vault.json",
    "git push",
    "git clone https://github.com/a/b",
    "npm test",
    "grep -r ssh src/",
    "ls ~/.ssh",
    "cat ~/.ssh/known_hosts",
    "cat ~/.ssh/id_ed25519.pub",
    "docker compose up",
    "rsync -av a b",
    "rsync -av ./a:b c",
    "rsync -avz src/ dest/",
    "node -e \"console.log('ssh')\"",
    "python3 -c 'print(\"ssh key\")'",
    "grep -rn subprocess src | grep ssh",
    "ls ~/.local/share",
    "ls ~/env/os/data",
    "cat ~/env/os/data/prefs.json",
    "echo base64 is fine",
    "echo aGk= | base64 -d",
    "curl localhost:4747/api/tabs",
    "curl -d 'x=%20' localhost:4747/api/tabs",
    "grep -n 'a#b' f",
    "git log --oneline",
    "strace -c ls",
  ])
    assert.equal(bash(command), null, command);
});
