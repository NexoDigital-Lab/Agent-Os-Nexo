// The last response of the selected request: status, time and size, body (JSON pretty-printed) or headers.
import { Check } from "lucide-react";
import { useState } from "react";
import type { HttpResult } from "../api";
import { useCopy } from "@os/lib/ui";
import { t } from "@os/i18n";

function pretty(body: string, headers: [string, string][]) {
  const ct = headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
  if (!ct.includes("json") && !/^\s*[[{]/.test(body)) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

export function ResponseView({ res, sending }: { res: HttpResult | undefined; sending: boolean }) {
  const [resTab, setResTab] = useState<"body" | "headers">("body");
  const { copied, copy } = useCopy();

  return (
    <div className="http-res">
      {!res ? (
        <div className="faint" style={{ padding: 16, fontSize: 13 }}>{sending ? t("Sending…") : t("The response shows up here. Enter in the URL sends too.")}</div>
      ) : !res.ok ? (
        <div className="http-status"><span className="pill bad">{t("Error")}</span><span className="errline">{res.error}</span></div>
      ) : (
        <>
          <div className="http-status">
            <span className={`pill ${res.status < 300 ? "ok" : res.status < 400 ? "accent" : "bad"}`}>{res.status} {res.statusText}</span>
            <span className="faint mono">{res.ms} ms · {kb(res.size)}</span>
            <span style={{ flex: 1 }} />
            <div className="seg">
              <button className={resTab === "body" ? "on" : ""} onClick={() => setResTab("body")}>{t("Body")}</button>
              <button className={resTab === "headers" ? "on" : ""} onClick={() => setResTab("headers")}>Headers · {res.headers.length}</button>
            </div>
            <button className="btn sm ghost" onClick={() => copy(res.body)} aria-label={copied ? t("Copied") : t("Copy the response")}>{copied ? <Check size={14} /> : t("Copy")}</button>
          </div>
          {resTab === "body" ? (
            <pre className="http-resbody mono">{pretty(res.body, res.headers) || <span className="faint">{t("(empty)")}</span>}</pre>
          ) : (
            <div className="http-resbody">
              {res.headers.map(([k, v]) => <div key={k} className="mono res-h"><b>{k}</b> {v}</div>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
