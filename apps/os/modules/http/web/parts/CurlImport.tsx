// Paste a curl command → a new request (method, headers, body and -u are converted).
import { useState } from "react";
import { parseCurl } from "../curl";
import type { HttpRequest } from "../api";
import { t } from "@os/i18n";

export function CurlImport({ target, onImport, onClose }: { target: string | null; onImport: (r: Omit<HttpRequest, "id" | "name"> & { name: string }) => void; onClose: () => void }) {
  const [curlText, setCurlText] = useState("");
  const [error, setError] = useState("");
  function importCurl() {
    try {
      const p = parseCurl(curlText);
      onImport({ name: `${p.method} ${p.url.replace(/^https?:\/\/[^/]+/, "") || "/"}`.slice(0, 60), ...p });
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: "min(640px, calc(100vw - 32px))" }} onClick={(e) => e.stopPropagation()}>
        <h3>{t("Import curl")}</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t("It goes into")} {target ? <b>{target}</b> : t("the first collection")}. {t("Method, headers, body and")} <span className="mono">-u</span> {t("convert on their own.")}
        </p>
        <textarea autoFocus className="field mono" rows={9} spellCheck={false} placeholder={"curl -X POST 'http://localhost:3000/auth/login' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"email\":\"a@b.com\"}'"} value={curlText} onChange={(e) => setCurlText(e.target.value)} />
        {error && <div className="errline">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn ghost" onClick={onClose}>{t("Cancel")}</button>
          <button className="btn primary" disabled={!curlText.trim()} onClick={importCurl}>{t("Import")}</button>
        </div>
      </div>
    </div>
  );
}
