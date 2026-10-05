import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { sessionsApi as api, type Skill } from "./api";
import { t } from "@os/i18n";

const SOURCE: Record<Skill["source"], string> = { nexo: "Nexo", library: "yours", claude: "~/.claude" };

/** Turn skills off for the recommender, or pin the ones that ride along on every task. */
export function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const reload = () => void api.skills().then(setSkills, () => {});
  useEffect(reload, []);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | Skill["source"] | "off">("all");

  async function save(next: Skill[]) {
    await api.savePrefs(next.filter((s) => !s.enabled).map((s) => s.name), next.filter((s) => s.pinned).map((s) => s.name));
    reload();
  }
  const patch = (name: string, p: Partial<Skill>) => save(skills.map((s) => (s.name === name ? { ...s, ...p } : s)));

  const shown = skills.filter(
    (s) =>
      (kind === "all" || (kind === "off" ? !s.enabled : s.source === kind)) &&
      (!q || `${s.name} ${s.description} ${s.source}`.toLowerCase().includes(q.toLowerCase())),
  );
  const on = skills.filter((s) => s.enabled);
  const pinnedTok = skills.filter((s) => s.pinned).reduce((n, s) => n + s.tokens, 0);

  return (
    <div className="page">
      <h1>Skills</h1>
      <p className="sub">
        {t("{on} of {total} on for the recommender.", { on: on.length, total: skills.length })}{" "}
        <span style={{ color: "var(--accent-text)" }}><Star size={13} fill="currentColor" /> {t("Pinned")}</span> {t("ones go on every task ({k}k tok).", { k: (pinnedTok / 1000).toFixed(1) })}{" "}
        {t("Saved in")} <span className="mono">library/profile.json</span>{t(", so agents in the terminal follow it too.")}
      </p>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <input className="field" placeholder={t("Search skill, description or source…")} aria-label={t("Search skill, description or source…")} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 380 }} />
        <div className="seg">
          {(["all", "nexo", "library", "claude", "off"] as const).map((k) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
              {t({ all: "All", nexo: "Nexo", library: "Yours", claude: "~/.claude", off: "Off" }[k])}
            </button>
          ))}
        </div>
      </div>
      <table className="sk-table">
        <thead>
          <tr>
            <th style={{ width: 50 }}>{t("On")}</th>
            <th style={{ width: 30 }} />
            <th>Skill</th>
            <th>{t("What it does")}</th>
            <th>{t("Source")}</th>
            <th style={{ textAlign: "right" }}>Tokens</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.name} className={s.enabled ? "" : "off"}>
              <td>
                <button className={`toggle ${s.enabled ? "on" : ""}`} aria-label={t("Enable {name}", { name: s.name })} aria-pressed={s.enabled} onClick={() => patch(s.name, { enabled: !s.enabled, pinned: s.enabled ? false : s.pinned })} />
              </td>
              <td>
                <button className={`star ${s.pinned ? "on" : ""}`} title={t("Pin: goes on every task")} aria-label={t("Pin {name}", { name: s.name })} aria-pressed={s.pinned} onClick={() => patch(s.name, { pinned: !s.pinned, enabled: true })}>
                  <Star size={14} fill={s.pinned ? "currentColor" : "none"} />
                </button>
              </td>
              <td className="n">
                {s.name}
              </td>
              <td className="muted" style={{ fontSize: 13 }}>{s.description}</td>
              <td><span className={`pill ${s.source === "nexo" ? "accent" : s.source === "library" ? "info" : ""}`}>{t(SOURCE[s.source])}</span></td>
              <td className="num faint" style={{ textAlign: "right" }}>{s.tokens ? `${(s.tokens / 1000).toFixed(1)}k` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
