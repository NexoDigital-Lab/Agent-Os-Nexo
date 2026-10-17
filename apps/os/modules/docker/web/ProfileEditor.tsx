// Editor of a project's start profiles: which compose file(s), the compose project name (-p), which services (none =
// all), and whether stopping keeps the containers (stop) or removes them (down; volumes always stay).
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { t } from "@os/i18n";
import type { Detection, Profile, StackConfig } from "./api";

export function ProfileEditor({ detection, initial, prodIds, onSave, onCancel }: {
  detection: Detection;
  initial: StackConfig;
  prodIds: string[];
  onSave: (c: StackConfig) => Promise<void>;
  onCancel?: () => void;
}) {
  const [profiles, setProfiles] = useState<[string, Profile][]>(Object.entries(initial.profiles));
  const [def, setDef] = useState(initial.default);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const files = detection.compose.filter((c) => !c.error).map((c) => c.file);

  const patch = (i: number, p: Partial<Profile>) => setProfiles((all) => all.map((e, j) => (j === i ? [e[0], { ...e[1], ...p }] : e)));
  const rename = (i: number, id: string) => {
    setProfiles((all) => all.map((e, j) => (j === i ? [id, e[1]] : e)));
    if (profiles[i]![0] === def) setDef(id);
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const add = () => {
    let id = "new";
    for (let n = 2; profiles.some(([x]) => x === id); n++) id = `new-${n}`;
    setProfiles((all) => [...all, [id, { files: files.slice(0, 1), projectName: all[0]?.[1].projectName ?? "project", services: [], stop: "stop" }]]);
  };

  const remove = (i: number) => {
    const rest = profiles.filter((_, j) => j !== i);
    setProfiles(rest);
    if (profiles[i]![0] === def) setDef(rest[0]![0]); // the default never points at a removed profile
  };

  async function save() {
    const ids = profiles.map(([id]) => id);
    const bad = ids.find((id) => !/^[\w-]{1,40}$/.test(id));
    if (bad !== undefined) return setErr(t("Profile names use letters, digits, - and _ (up to 40): \"{name}\"", { name: bad }));
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup !== undefined) return setErr(t("Two profiles are named \"{name}\"", { name: dup }));
    setSaving(true);
    setErr("");
    try {
      await onSave({ version: 1, default: def, profiles: Object.fromEntries(profiles) });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dkp-editor">
      {profiles.map(([id, p], i) => {
        const services = [...new Set(detection.compose.filter((c) => p.files.includes(c.file)).flatMap((c) => c.services.map((s) => s.name)))];
        return (
          <fieldset key={i} className="dkp-card dkp-edit">
            <div className="dkp-edit-row">
              <label><span className="faint">{t("Name")}</span><input className="field mono" value={id} aria-label={t("Profile name")} onChange={(e) => rename(i, e.target.value)} /></label>
              <label><span className="faint">{t("Label")}</span><input className="field" value={p.label ?? ""} onChange={(e) => patch(i, { label: e.target.value })} /></label>
              <label><span className="faint">{t("Compose project (-p)")}</span><input className="field mono" value={p.projectName} onChange={(e) => patch(i, { projectName: e.target.value })} /></label>
              <label className="dkp-inline"><input type="radio" name="dkp-default" checked={def === id} onChange={() => setDef(id)} /> {t("default")}</label>
              {prodIds.includes(id) && <span className="pill bad">{t("production")}</span>}
              <span style={{ flex: 1 }} />
              <button className="btn sm ghost danger" disabled={profiles.length < 2} aria-label={t("Remove the profile {name}", { name: id })} onClick={() => remove(i)}><Trash2 size={14} /></button>
            </div>
            <div className="dkp-edit-row">
              <span className="faint">{t("Compose files")}</span>
              {files.map((f) => <label key={f} className="dkp-inline mono"><input type="checkbox" checked={p.files.includes(f)} onChange={() => patch(i, { files: toggle(p.files, f) })} /> {f}</label>)}
            </div>
            {services.length > 0 && (
              <div className="dkp-edit-row">
                <span className="faint">{t("Services (none checked = all)")}</span>
                {services.map((s) => <label key={s} className="dkp-inline mono"><input type="checkbox" checked={p.services.includes(s)} onChange={() => patch(i, { services: toggle(p.services, s) })} /> {s}</label>)}
              </div>
            )}
            <div className="dkp-edit-row">
              <span className="faint">{t("When stopping")}</span>
              <label className="dkp-inline"><input type="radio" name={`dkp-stop-${i}`} checked={p.stop === "stop"} onChange={() => patch(i, { stop: "stop" })} /> {t("keep the containers (stop)")}</label>
              <label className="dkp-inline"><input type="radio" name={`dkp-stop-${i}`} checked={p.stop === "down"} onChange={() => patch(i, { stop: "down" })} /> {t("remove the containers (down; volumes stay)")}</label>
            </div>
          </fieldset>
        );
      })}
      {err && <div className="errline" role="alert">{err}</div>}
      <div className="dkp-edit-row">
        <button className="btn sm ghost" onClick={add}><Plus size={14} /> {t("Add a profile")}</button>
        <span style={{ flex: 1 }} />
        {onCancel && <button className="btn sm ghost" onClick={onCancel}>{t("Cancel")}</button>}
        <button className="btn sm primary" disabled={saving} onClick={() => void save()}>{saving ? <span className="spin" /> : null} {t("Save")}</button>
      </div>
    </div>
  );
}
