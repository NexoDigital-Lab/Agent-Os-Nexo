// Collections and their requests, the active environment, and import (curl / Postman JSON) / export.
import { ChevronDown, ChevronRight, Copy, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { uid, toPostman } from "../curl";
import type { Collection, HttpRequest, HttpStore } from "../api";
import { toggled } from "@os/lib/ui";
import { t } from "@os/i18n";
import { ConfirmButton } from "@os/lib/ConfirmButton";
import { askText } from "@os/lib/dialog";

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function CollectionsSidebar({ store, update, patchColl, sel, setSel, addRequest, addCollection, blankReq, onCurl, onImportFile, onEnvs }: {
  store: HttpStore;
  update: (fn: (s: HttpStore) => HttpStore) => void;
  patchColl: (id: string, fn: (c: Collection) => Collection) => void;
  sel: { c: string; r: string } | null;
  setSel: (s: { c: string; r: string } | null) => void;
  addRequest: (r: HttpRequest, collId?: string) => void;
  addCollection: () => void;
  blankReq: () => HttpRequest;
  onCurl: () => void;
  onImportFile: (f: File) => void;
  onEnvs: () => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);
  const toggle = (id: string) => setClosed((x) => toggled(x, id));

  return (
    <aside className="http-side">
      <div className="http-head">
        <span className="eyebrow">API</span>
        <span style={{ flex: 1 }} />
        <button className="btn sm ghost" title={t("Import curl")} onClick={onCurl}>curl <Download size={14} /></button>
        <button className="btn sm ghost" title={t("Import a collection (Postman / Thunder Client JSON)")} onClick={() => fileInput.current?.click()}>JSON <Download size={14} /></button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ""; }} />
      </div>
      <div className="http-env">
        <select className="field" value={store.activeEnv ?? ""} onChange={(e) => update((s) => ({ ...s, activeEnv: e.target.value || null }))}>
          <option value="">{t("No environment")}</option>
          {store.envs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button className="btn sm ghost" title={t("Edit environments and variables")} aria-label={t("Edit environments and variables")} onClick={onEnvs}>{"{{ }}"}</button>
      </div>
      <div className="http-colls">
        {store.collections.map((c) => (
          <div key={c.id}>
            <div className="coll-row" onClick={() => toggle(c.id)}>
              <span className="caret">{closed.has(c.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
              <span className="nm">{c.name}</span>
              <span className="faint mono cnt">{c.requests.length}</span>
              <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                <button title={t("New request")} aria-label={t("New request")} onClick={() => (setClosed((x) => { const n = new Set(x); n.delete(c.id); return n; }), addRequest(blankReq(), c.id))}><Plus size={14} /></button>
                <button title={t("Export (Postman v2.1; Thunder Client imports it)")} aria-label={t("Export")} onClick={() => download(`${c.name}.postman_collection.json`, toPostman(c))}><Upload size={14} /></button>
                <button title={t("Rename")} aria-label={t("Rename")} onClick={async () => { const n = await askText(t("Name"), c.name); if (n) patchColl(c.id, (x) => ({ ...x, name: n })); }}><Pencil size={14} /></button>
                <ConfirmButton className="" title={t("Delete collection")} confirmText={t("Delete the collection \"{name}\" and its {n} requests?", { name: c.name, n: c.requests.length })} onConfirm={() => {
                  update((s) => ({ ...s, collections: s.collections.filter((x) => x.id !== c.id) }));
                  if (sel?.c === c.id) setSel(null);
                }}><Trash2 size={14} /></ConfirmButton>
              </span>
            </div>
            {!closed.has(c.id) && c.requests.map((r) => (
              <div key={r.id} className={`req-row ${sel?.r === r.id ? "on" : ""}`} onClick={() => setSel({ c: c.id, r: r.id })}>
                <span className={`meth m-${r.method}`}>{r.method === "DELETE" ? "DEL" : r.method === "OPTIONS" ? "OPT" : r.method}</span>
                <span className="nm">{r.name}</span>
                <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button title={t("Duplicate")} aria-label={t("Duplicate")} onClick={() => addRequest({ ...structuredClone(r), id: uid(), name: `${r.name} ${t("(copy)")}` }, c.id)}><Copy size={14} /></button>
                  <button title={t("Delete")} aria-label={t("Delete")} onClick={() => {
                    patchColl(c.id, (x) => ({ ...x, requests: x.requests.filter((y) => y.id !== r.id) }));
                    if (sel?.r === r.id) setSel(null);
                  }}><Trash2 size={14} /></button>
                </span>
              </div>
            ))}
          </div>
        ))}
        <button className="btn sm ghost http-newcoll" onClick={addCollection}><Plus size={14} /> {t("Collection")}</button>
      </div>
    </aside>
  );
}
