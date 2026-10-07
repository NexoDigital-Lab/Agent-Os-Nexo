// Where a task is written: skill recommendation + picker, images (paste / drop / 📎), work mode, permission
// mode, provider + model, and the buttons that send it (plus actions other modules add, like "Practice this").
import { Paperclip, Play, Sparkles, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { readStr, writeStr } from "@os/lib/storage";
import { toggled } from "@os/lib/ui";
import { slot } from "@os/registry";
import { prepareImage, sessionsApi as api, type Mode, type ProviderId, type Recommendation, type Skill, type Tab, type WorkMode } from "../api";
import type { ComposerAction, TabViewProps } from "../slots";
import { t } from "@os/i18n";

const WORK_MODES: { v: WorkMode; label: string; hint: string }[] = [
  { v: "relax", label: "Relax", hint: "Automatic: the agent plans, builds and verifies" },
  { v: "focus", label: "Focus", hint: "Control: a briefing per sector, then it waits for your OK before writing" },
  { v: "practice", label: "Practice", hint: "You write the code: the agent prepares steps and hints, and checks your work" },
];

const MODES: { v: Mode; label: string }[] = [
  { v: "default", label: "Ask permission" },
  { v: "acceptEdits", label: "Auto-edit" },
  { v: "plan", label: "Plan" },
  { v: "bypassPermissions", label: "No brakes" },
];
const MODELS = [
  { v: "", label: "Default model" },
  { v: "sonnet", label: "Sonnet" },
  { v: "opus", label: "Opus" },
  { v: "haiku", label: "Haiku" },
];

export function Composer({ tab, skills, running, prompt, setPrompt, view }: {
  tab: Tab;
  skills: Skill[];
  running: boolean;
  prompt: string; // lifted: drafts from features and the setup assistant land here
  setPrompt: (p: string) => void;
  view: TabViewProps;
}) {
  const [workMode, setWorkMode] = useState<WorkMode>("relax");
  // The permission mode sticks per tab (this browser), instead of snapping back to "Ask permission".
  const [mode, setMode] = useState<Mode>(() => MODES.find((m) => m.v === readStr(`mode:${tab.id}`))?.v ?? "default");
  useEffect(() => {
    writeStr(`mode:${tab.id}`, mode);
  }, [mode]);
  const [model, setModel] = useState("");
  // Enabled providers for the picker (GET /api/providers, T1 route). Empty until it answers; the send
  // payload then omits provider and the server keeps the session's current one (or the active default).
  const [enabledProviders, setEnabledProviders] = useState<{ id: ProviderId; label: string }[]>([]);
  // What the next send will use: the session's provider unless the user picks another one here.
  const [providerPick, setProviderPick] = useState<string>("");
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [recLoading, setRecLoading] = useState(false);
  const [addSkill, setAddSkill] = useState("");
  const [error, setError] = useState("");
  const [images, setImages] = useState<{ name: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.providers().then((r) => {
      setEnabledProviders(r.providers.filter((p) => r.enabled.includes(p.id)).map((p) => ({ id: p.id, label: p.label })));
    }, () => {});
  }, [tab.id]);

  const effectiveProvider = (providerPick || tab.provider || "claude") as string;
  // Models are claude-specific in v1: the model dropdown shows only on the SDK path.
  const showModel = effectiveProvider === "claude";

  async function addImages(files: Iterable<Blob>) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setError("");
    setUploading((n) => n + list.length);
    for (const f of list) {
      try {
        const up = await api.upload(tab.id, await prepareImage(f));
        setImages((prev) => [...prev, up]);
      } catch (e) {
        setError(t((e as Error).message));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function removeImage(name: string) {
    setImages((prev) => prev.filter((i) => i.name !== name));
    api.deleteUpload(tab.id, name);
  }

  async function recommend() {
    if (!prompt.trim()) return;
    setRecLoading(true);
    setError("");
    try {
      const r = await api.recommend(prompt, tab.project);
      setRecs(r.skills);
      setPicked(new Set(r.skills.map((s) => s.name)));
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setRecLoading(false);
    }
  }

  async function run() {
    if (!prompt.trim() || running || uploading) return;
    setError("");
    try {
      await api.send(tab.id, {
        prompt,
        skills: [...picked],
        images: images.map((i) => i.name),
        mode,
        model: showModel ? model || undefined : undefined,
        workMode,
        provider: providerPick && providerPick !== (tab.provider ?? "claude") ? (providerPick as ProviderId) : undefined,
      });
      setPrompt("");
      setImages([]);
      setRecs(null);
      setPicked(new Set());
    } catch (e) {
      setError(t((e as Error).message));
    }
  }

  const actions = slot<ComposerAction>("composer.actions").filter((a) => !a.workMode || a.workMode === workMode);
  const runAction = (a: ComposerAction) => {
    if (!prompt.trim()) return;
    a.run(view, prompt);
    setPrompt("");
  };

  const pickedTokens = [...picked].reduce((s, n) => s + (skills.find((k) => k.name === n)?.tokens ?? 0), 0);
  const enabled = skills.filter((s) => s.enabled && !picked.has(s.name));

  return (
    <div
      className={`composer ${dragging ? "drag" : ""}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addImages(e.dataTransfer.files);
      }}
    >
      {recs && (
        <div className="picker">
          <div className="head">
            <span className="eyebrow">{t("Skills for this task")}</span>
            <span className="faint num" style={{ fontSize: 12 }}>
              {t("{n} chosen", { n: picked.size })} · ~{(pickedTokens / 1000).toFixed(1)}k tok
            </span>
          </div>
          {recs.length === 0 && <div className="faint" style={{ fontSize: 13, padding: 4 }}>{t("None needed: it runs without skills.")}</div>}
          {recs.map((r) => {
            const sk = skills.find((s) => s.name === r.name);
            return (
              <label key={r.name} className="sk-row">
                <input
                  type="checkbox"
                  checked={picked.has(r.name)}
                  onChange={() => setPicked(toggled(picked, r.name))}
                />
                <div>
                  <div className="n">{r.name}</div>
                  <div className="w">{r.why || t("pinned: always goes")}</div>
                </div>
                <span className="faint num" style={{ fontSize: 11.5 }}>{sk ? `${(sk.tokens / 1000).toFixed(1)}k` : ""}</span>
              </label>
            );
          })}
          <div className="sk-add">
            <select className="field" value={addSkill} onChange={(e) => setAddSkill(e.target.value)} style={{ fontSize: 12.5, padding: "5px 26px 5px 8px" }}>
              <option value="">{t("+ add another skill…")}</option>
              {enabled.map((s) => (
                <option key={s.name} value={s.name}>{s.name} — {s.description.slice(0, 70)}</option>
              ))}
            </select>
            <button
              className="btn sm"
              disabled={!addSkill}
              onClick={() => {
                setRecs([...recs, { name: addSkill, why: skills.find((s) => s.name === addSkill)?.description ?? "" }]);
                setPicked(new Set([...picked, addSkill]));
                setAddSkill("");
              }}
            >
              {t("Add")}
            </button>
          </div>
        </div>
      )}
      {(images.length > 0 || uploading > 0) && (
        <div className="attach">
          {images.map((img) => (
            <div key={img.name} className="att">
              <img src={img.url} alt="" />
              <button title={t("Remove")} aria-label={t("Remove image")} onClick={() => removeImage(img.name)}><X size={12} /></button>
            </div>
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <div key={`u${i}`} className="att loading"><span className="spin" /></div>
          ))}
        </div>
      )}
      <textarea
        className="field"
        onPaste={(e) => {
          const files = [...e.clipboardData.items].filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter((f): f is File => !!f);
          if (files.some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            addImages(files);
          }
        }}
        placeholder={t("Task for {project}…  (Ctrl+Enter: recommend skills · again: run · Ctrl+V / drop images)", { project: tab.project || tab.title })}
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          if (recs) setRecs(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            recs ? run() : recommend();
          }
        }}
      />
      <div className="row">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addImages(e.target.files);
            e.target.value = "";
          }}
        />
        <button className="btn ghost sm" title={t("Attach images (temporary, for this tab)")} aria-label={t("Attach images")} onClick={() => fileRef.current?.click()}>
          <Paperclip size={14} />{images.length > 0 ? ` ${images.length}` : ""}
        </button>
        <select className="field" value={workMode} title={t(WORK_MODES.find((w) => w.v === workMode)?.hint ?? "")} aria-label={t("Work mode")} onChange={(e) => setWorkMode(e.target.value as WorkMode)}>
          {WORK_MODES.map((w) => <option key={w.v} value={w.v}>{t(w.label)}</option>)}
        </select>
        <select className="field" value={mode} aria-label={t("Permission mode")} onChange={(e) => setMode(e.target.value as Mode)}>
          {MODES.map((m) => <option key={m.v} value={m.v}>{t(m.label)}</option>)}
        </select>
        {enabledProviders.length > 0 && (
          <select className="field" value={effectiveProvider} aria-label={t("Provider")} onChange={(e) => setProviderPick(e.target.value)}>
            {enabledProviders.map((p) => <option key={p.id} value={p.id}>{t(p.label)}</option>)}
          </select>
        )}
        {showModel ? (
          <select className="field" value={model} aria-label={t("Model")} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => <option key={m.v} value={m.v}>{t(m.label)}</option>)}
          </select>
        ) : (
          <span className="faint" style={{ fontSize: 11.5, alignSelf: "center" }}>{t("New provider session")}</span>
        )}
        <span className="grow errline">{error}</span>
        {running ? (
          <button className="btn danger" onClick={() => api.interrupt(tab.id)}><Square size={14} /> {t("Stop")}</button>
        ) : workMode === "practice" && !recs ? (
          <>
            <button className="btn ghost" disabled={!prompt.trim()} onClick={run} title={t("Ask the agent in practice mode (it guides, it doesn't write code)")}>{t("Ask")}</button>
            {actions.map((a) => (
              <button key={a.id} className={`btn ${a.primary ? "primary" : "ghost"}`} disabled={!prompt.trim()} onClick={() => runAction(a)}><a.icon size={14} /> {t(a.label)}</button>
            ))}
          </>
        ) : recs ? (
          <>
            <button className="btn ghost" onClick={() => setRecs(null)}>{t("Cancel")}</button>
            <button className="btn primary" onClick={run}><Play size={14} /> {t("Run with {n} skills", { n: picked.size })}</button>
          </>
        ) : (
          <>
            <button className="btn ghost" disabled={!prompt.trim()} onClick={run} title={t("No recommendation, no skills")}>{t("Direct")}</button>
            <button className="btn primary" disabled={!prompt.trim() || recLoading} onClick={recommend}>
              {recLoading ? <span className="spin" /> : <Sparkles size={14} />} {t("Recommend skills")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
