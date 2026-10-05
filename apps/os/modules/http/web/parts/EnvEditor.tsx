// Environments and their {{variables}} (baseUrl, tokens…), used in URL, headers and body.
import { Plus } from "lucide-react";
import { useState } from "react";
import { uid } from "../curl";
import type { Env, HttpStore } from "../api";
import { KVTable } from "./KVTable";
import { t } from "@os/i18n";
import { ConfirmButton } from "@os/lib/ConfirmButton";

export function EnvEditor({ store, update, onClose }: { store: HttpStore; update: (fn: (s: HttpStore) => HttpStore) => void; onClose: () => void }) {
  const [cur, setCur] = useState<string | null>(store.activeEnv ?? store.envs[0]?.id ?? null);
  const env = store.envs.find((e) => e.id === cur) ?? null;
  const patch = (p: Partial<Env>) => update((s) => ({ ...s, envs: s.envs.map((e) => (e.id === cur ? { ...e, ...p } : e)) }));
  function add() {
    const name = prompt(t("Environment name"), store.envs.length ? "prod" : "local");
    if (!name) return;
    const e: Env = { id: uid(), name, vars: [{ k: "baseUrl", v: "http://localhost:3000", on: true }] };
    update((s) => ({ ...s, envs: [...s.envs, e], activeEnv: s.activeEnv ?? e.id }));
    setCur(e.id);
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: "min(640px, calc(100vw - 32px))" }} onClick={(e) => e.stopPropagation()}>
        <h3>{t("Environments")}</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t("Use")} <span className="mono">{"{{name}}"}</span> {t("in the URL, headers or body. Saved in")} <span className="mono">os/data/http/store.json</span>{t(", never versioned.")}
        </p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {store.envs.map((e) => (
            <button key={e.id} className={`btn sm ${e.id === cur ? "primary" : "ghost"}`} onClick={() => setCur(e.id)}>{e.name}</button>
          ))}
          <button className="btn sm ghost" onClick={add}><Plus size={14} /> {t("Environment")}</button>
        </div>
        {env && (
          <>
            <KVTable rows={env.vars} onChange={(vars) => patch({ vars })} keyPh="variable" valPh="valor" />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn sm ghost" onClick={() => { const n = prompt(t("Name"), env.name); if (n) patch({ name: n }); }}>{t("Rename")}</button>
              <ConfirmButton className="btn sm ghost danger" title={t("Delete")} confirmText={t("Delete the environment {name}?", { name: env.name })} onConfirm={() => {
                update((s) => ({ ...s, envs: s.envs.filter((e) => e.id !== env.id), activeEnv: s.activeEnv === env.id ? null : s.activeEnv }));
                setCur(null);
              }}>{t("Delete")}</ConfirmButton>
            </div>
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn primary" onClick={onClose}>{t("Done::close")}</button>
        </div>
      </div>
    </div>
  );
}
