// The selected request: name, method + URL, and its headers / body / generated cURL.
import { Check, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { resolved, toCurl } from "../curl";
import type { HttpRequest, KV } from "../api";
import { KVTable } from "./KVTable";
import { useCopy } from "@os/lib/ui";
import { t } from "@os/i18n";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function RequestEditor({ req, vars, patchReq, sending, sendReq, onError }: {
  req: HttpRequest;
  vars: KV[];
  patchReq: (p: Partial<HttpRequest>) => void;
  sending: boolean;
  sendReq: () => void;
  onError: (msg: string) => void;
}) {
  const [reqTab, setReqTab] = useState<"headers" | "body" | "curl">("headers");
  const { copied, copy } = useCopy();
  const curl = useMemo(() => toCurl(resolved(req, vars)), [req, vars]);

  return (
    <>
      <input className="http-name" value={req.name} onChange={(e) => patchReq({ name: e.target.value })} />
      <div className="http-url">
        <select className={`field meth-sel m-${req.method}`} value={req.method} onChange={(e) => patchReq({ method: e.target.value })}>
          {METHODS.map((m) => <option key={m}>{m}</option>)}
        </select>
        <input
          className="field mono"
          placeholder="{{baseUrl}}/api/..."
          value={req.url}
          onChange={(e) => patchReq({ url: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") sendReq(); }}
        />
        <button className="btn primary" disabled={sending || !req.url.trim()} onClick={sendReq}>{sending ? <span className="spin" /> : t("Send")}</button>
      </div>
      <div className="seg http-tabs">
        <button className={reqTab === "headers" ? "on" : ""} onClick={() => setReqTab("headers")}>Headers{req.headers.length ? ` · ${req.headers.filter((h) => h.on).length}` : ""}</button>
        <button className={reqTab === "body" ? "on" : ""} onClick={() => setReqTab("body")}>Body{req.body ? " ●" : ""}</button>
        <button className={reqTab === "curl" ? "on" : ""} onClick={() => setReqTab("curl")}>cURL</button>
      </div>
      <div className="http-reqpane">
        {reqTab === "headers" && <KVTable rows={req.headers} onChange={(headers) => patchReq({ headers })} keyPh="Header" valPh={t("Value — {{token}} uses the environment")} />}
        {reqTab === "body" && (
          <>
            <textarea className="field mono http-body" spellCheck={false} placeholder='{"email": "{{user}}"}' value={req.body} onChange={(e) => patchReq({ body: e.target.value })} />
            <div className="http-bodytools">
              <button className="btn sm ghost" onClick={() => { try { patchReq({ body: JSON.stringify(JSON.parse(req.body), null, 2) }); } catch { onError(t("The body is not valid JSON")); } }}>{t("Format JSON")}</button>
              {!req.headers.some((h) => h.k.toLowerCase() === "content-type") && (
                <button className="btn sm ghost" onClick={() => patchReq({ headers: [...req.headers, { k: "Content-Type", v: "application/json", on: true }] })}><Plus size={14} /> Content-Type: json</button>
              )}
            </div>
          </>
        )}
        {reqTab === "curl" && (
          <div className="http-curl">
            <pre className="mono">{curl}</pre>
            <button className="btn sm" onClick={() => copy(curl)}>{copied ? <><Check size={14} /> {t("Copied")}</> : t("Copy curl")}</button>
            <span className="faint" style={{ fontSize: 12 }}>{t("With the environment variables already filled in.")}</span>
          </div>
        )}
      </div>
    </>
  );
}
