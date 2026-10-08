// Settings → Permissions: what agents may do alone. Global rules, or a project's own on top of them; each change goes
// through `nexo permissions` (validated) and every AI's files are refreshed, so it applies to the next action.
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@os/i18n";
import { permissionsApi as api, type Area, type Decision, type PermissionsView, type Rules } from "./api";

const DECISIONS: Decision[] = ["allow", "ask", "deny"];
const AREAS: { id: Area; label: string; hint: string; example: string }[] = [
  { id: "commands", label: "Commands", hint: "Shell commands, by prefix (* at the end)", example: "npm run test*" },
  { id: "files.edit", label: "Editing files", hint: "Paths from the environment root (** for any depth)", example: "projects/*/context/**" },
  { id: "files.read", label: "Reading files", hint: "Paths from the environment root (** for any depth)", example: "library/**" },
];
const SETTINGS: { key: string; label: string }[] = [
  { key: "default", label: "Anything not listed" },
  { key: "os.build", label: "Build a new agent-os-nexo version" },
  { key: "os.restart", label: "Restart agent-os-nexo" },
  { key: "os.vault", label: "Open the SSH vault" },
];

const rulesOf = (p: PermissionsView["effective"] | null | undefined, area: Area): Rules =>
  (area === "commands" ? p?.commands : area === "files.edit" ? p?.files?.edit : p?.files?.read) ?? {};

export function PermissionsSettings() {
  const [project, setProject] = useState<string | null>(null);
  const [data, setData] = useState<PermissionsView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<Area, { pattern: string; decision: Decision }>>({
    commands: { pattern: "", decision: "ask" }, "files.edit": { pattern: "", decision: "ask" }, "files.read": { pattern: "", decision: "allow" },
  });

  useEffect(() => {
    setData(null);
    api.view(project).then(setData, (e: Error) => setError(t(e.message)));
  }, [project]);

  async function apply(fn: () => Promise<PermissionsView>) {
    setBusy(true);
    setError("");
    try {
      setData(await fn());
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="faint">{error || t("Loading…")}</div>;
  // In a project, its own file is what gets edited; the global rules show as inherited.
  const editable = project ? data.own : data.global;
  const value = (key: string): Decision | "" => {
    const pick = (p: PermissionsView["effective"] | null) => {
      if (!p) return undefined;
      if (key === "default") return p.default;
      const [, action] = key.split(".");
      return p.os?.[action as "build" | "restart" | "vault"];
    };
    return pick(editable) ?? (project ? "" : pick(data.global) ?? "");
  };

  return (
    <div className="perm-settings">
      <p className="faint perm-intro">
        {t("What agents may do on their own: allow = do it, ask = ask you first, deny = never. Changes apply to the next action of every AI.")}
      </p>
      <label className="perm-scope">
        <span>{t("Rules for")}</span>
        <select className="field" value={project ?? ""} onChange={(e) => setProject(e.target.value || null)} disabled={busy}>
          <option value="">{t("Every project (global)")}</option>
          {data.projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      {error && <div className="errline" role="alert">{error}</div>}

      <section className="perm-block">
        <div className="eyebrow">{t("Actions")}</div>
        <div className="perm-settings-grid">
          {SETTINGS.map((s) => (
            <label key={s.key} className="perm-setting">
              <span>{t(s.label)}</span>
              <select className="field" value={value(s.key)} disabled={busy} onChange={(e) => void apply(() => api.setting(project, s.key, e.target.value as Decision))}>
                {project && value(s.key) === "" && <option value="">{t("as global")}</option>}
                {DECISIONS.map((d) => <option key={d} value={d}>{t(d)}</option>)}
              </select>
            </label>
          ))}
        </div>
      </section>

      {AREAS.map((a) => {
        const own = rulesOf(editable, a.id);
        const inherited = project ? rulesOf(data.global, a.id) : {};
        const d = draft[a.id];
        const add = () =>
          void apply(async () => {
            const out = await api.rule(project, a.id, d.decision, d.pattern);
            setDraft({ ...draft, [a.id]: { ...d, pattern: "" } });
            return out;
          });
        return (
          <section key={a.id} className="perm-block">
            <div className="eyebrow">{t(a.label)}</div>
            <div className="faint perm-hint">{t(a.hint)}</div>
            <div className="perm-cols">
              {DECISIONS.map((dec) => (
                <div key={dec} className={`perm-col ${dec}`}>
                  <div className="perm-col-head">{t(dec)}</div>
                  {(own[dec] ?? []).map((p) => (
                    <span key={`own-${p}`} className="perm-chip mono">
                      {p}
                      <button aria-label={t("Remove {pattern}", { pattern: p })} title={t("Remove")} disabled={busy} onClick={() => void apply(() => api.rule(project, a.id, null, p))}><X size={11} /></button>
                    </span>
                  ))}
                  {(inherited[dec] ?? []).map((p) => (
                    <span key={`inh-${p}`} className="perm-chip mono inherited" title={t("From the global rules")}>{p}</span>
                  ))}
                  {!(own[dec]?.length || inherited[dec]?.length) && <span className="faint perm-none">—</span>}
                </div>
              ))}
            </div>
            <form className="perm-add" onSubmit={(e) => (e.preventDefault(), d.pattern.trim() && add())}>
              <input className="field mono" value={d.pattern} maxLength={200} placeholder={a.example} aria-label={t("New pattern for {area}", { area: t(a.label) })}
                onChange={(e) => setDraft({ ...draft, [a.id]: { ...d, pattern: e.target.value } })} />
              <select className="field" value={d.decision} onChange={(e) => setDraft({ ...draft, [a.id]: { ...d, decision: e.target.value as Decision } })} aria-label={t("Decision")}>
                {DECISIONS.map((dec) => <option key={dec} value={dec}>{t(dec)}</option>)}
              </select>
              <button className="btn sm" type="submit" disabled={busy || !d.pattern.trim()}><Plus size={13} /> {t("Add")}</button>
            </form>
          </section>
        );
      })}
    </div>
  );
}
