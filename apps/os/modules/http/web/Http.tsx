// API client (Thunder Client style): collections of requests with {{env}} variables, curl/Postman import,
// auto-saved to os/data/http.json. The pieces live in http/.
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { httpApi as api, type Collection, type HttpRequest, type HttpResult, type HttpStore } from "./api";
import { fromPostman, resolved, uid } from "./curl";
import { CollectionsSidebar } from "./parts/CollectionsSidebar";
import { RequestEditor } from "./parts/RequestEditor";
import { ResponseView } from "./parts/ResponseView";
import { CurlImport } from "./parts/CurlImport";
import { EnvEditor } from "./parts/EnvEditor";
import { t } from "@os/i18n";

const blankReq = (): HttpRequest => ({ id: uid(), name: t("New request"), method: "GET", url: "{{baseUrl}}/", headers: [], body: "" });

export function Http() {
  const [store, setStore] = useState<HttpStore | null>(null);
  const [sel, setSel] = useState<{ c: string; r: string } | null>(null);
  const [results, setResults] = useState<Record<string, HttpResult>>({});
  const [sending, setSending] = useState(false);
  const [modal, setModal] = useState<"" | "curl" | "envs">("");
  const [error, setError] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    api.httpStore().then((s) => {
      setStore(s);
      const c = s.collections[0];
      if (c?.requests[0]) setSel({ c: c.id, r: c.requests[0].id });
    }).catch((e) => setError(e.message));
  }, []);

  // Auto-save, debounced; skips the initial load.
  useEffect(() => {
    if (!store) return;
    if (!loaded.current) {
      loaded.current = true;
      return;
    }
    const t = setTimeout(() => api.saveHttpStore(store).catch((e) => setError(e.message)), 400);
    return () => clearTimeout(t);
  }, [store]);

  const vars = store?.envs.find((e) => e.id === store.activeEnv)?.vars ?? [];
  const coll = store?.collections.find((c) => c.id === sel?.c) ?? null;
  const req = coll?.requests.find((r) => r.id === sel?.r) ?? null;

  const update = (fn: (s: HttpStore) => HttpStore) => setStore((s) => (s ? fn(s) : s));
  const patchColl = (id: string, fn: (c: Collection) => Collection) => update((s) => ({ ...s, collections: s.collections.map((c) => (c.id === id ? fn(c) : c)) }));
  const patchReq = (p: Partial<HttpRequest>) => sel && patchColl(sel.c, (c) => ({ ...c, requests: c.requests.map((r) => (r.id === sel.r ? { ...r, ...p } : r)) }));

  function addCollection(c?: Collection) {
    const col = c ?? { id: uid(), name: prompt(t("Collection name"), t("My API")) || "", requests: [] };
    if (!col.name) return;
    update((s) => ({ ...s, collections: [...s.collections, col] }));
    if (col.requests[0]) setSel({ c: col.id, r: col.requests[0].id });
  }

  /** Adds a request to `collId`, or to the selected/first collection, creating one if there are none. */
  function addRequest(r: HttpRequest, collId?: string) {
    const target = collId ?? sel?.c ?? store?.collections[0]?.id;
    if (!target) {
      const col = { id: uid(), name: "Mis requests", requests: [r] };
      update((s) => ({ ...s, collections: [...s.collections, col] }));
      setSel({ c: col.id, r: r.id });
      return;
    }
    patchColl(target, (c) => ({ ...c, requests: [...c.requests, r] }));
    setSel({ c: target, r: r.id });
  }

  async function sendReq() {
    if (!req || sending) return;
    setSending(true);
    setError("");
    try {
      const out = await api.httpSend(resolved(req, vars));
      setResults((p) => ({ ...p, [req.id]: out }));
    } catch (e: any) {
      setResults((p) => ({ ...p, [req.id]: { ok: false, ms: 0, error: e.message } }));
    } finally {
      setSending(false);
    }
  }

  async function importFile(f: File) {
    try {
      addCollection(fromPostman(JSON.parse(await f.text())));
    } catch (e: any) {
      setError(`No pude importar ${f.name}: ${e.message}`);
    }
  }

  if (!store) return <div className="page">{error ? <div className="errline">{error}</div> : <span className="spin" />}</div>;

  return (
    <div className="http">
      <CollectionsSidebar
        store={store}
        update={update}
        patchColl={patchColl}
        sel={sel}
        setSel={setSel}
        addRequest={addRequest}
        addCollection={() => addCollection()}
        blankReq={blankReq}
        onCurl={() => setModal("curl")}
        onImportFile={importFile}
        onEnvs={() => setModal("envs")}
      />

      <section className="http-main">
        {!req ? (
          <div className="empty" style={{ marginTop: 80 }}>
            <p>{t("Pick a request, create one or paste a curl command.")}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button className="btn primary" onClick={() => addRequest(blankReq())}><Plus size={16} /> {t("New request")}</button>
              <button className="btn" onClick={() => setModal("curl")}>{t("Paste curl")}</button>
            </div>
          </div>
        ) : (
          <>
            <RequestEditor key={req.id} req={req} vars={vars} patchReq={patchReq} sending={sending} sendReq={sendReq} onError={setError} />
            <ResponseView key={`r-${req.id}`} res={results[req.id]} sending={sending} />
          </>
        )}
        {error && <div className="errline http-err" onClick={() => setError("")}>{error}</div>}
      </section>

      {modal === "curl" && (
        <CurlImport target={coll?.name ?? null} onImport={(r) => (addRequest({ id: uid(), ...r }), setModal(""))} onClose={() => setModal("")} />
      )}
      {modal === "envs" && <EnvEditor store={store} update={update} onClose={() => setModal("")} />}
    </div>
  );
}
