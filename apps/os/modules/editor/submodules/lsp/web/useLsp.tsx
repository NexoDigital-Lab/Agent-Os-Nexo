// Language servers for the workspace: the first time a Go or Python file is active, start its client; the pill
// in the toolbar shows the state (and points to Environment when the server isn't installed).
import { CircleX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { editorApi as api, type Tab } from "../../../web/api";
import { LspClient, type LspState } from "./lsp";
import { t } from "@os/i18n";

const LSP_LANGS = ["go", "python"];
export type LspStatus = { state: LspState | "missing"; name: string | null; hint: string | null };

export function useLsp(tab: Tab, lang: string | null) {
  const clients = useRef(new Map<string, LspClient>());
  const [status, setStatus] = useState<Record<string, LspStatus>>({});

  useEffect(() => {
    if (!lang || !LSP_LANGS.includes(lang) || clients.current.has(lang) || status[lang]) return;
    api.lspStatus(lang).then((st) => {
      if (!st.available) return setStatus((p) => ({ ...p, [lang]: { state: "missing", name: st.name, hint: st.hint } }));
      clients.current.set(lang, new LspClient(tab.id, lang, tab.cwd, (state) => setStatus((p) => ({ ...p, [lang]: { state, name: st.name, hint: null } }))));
    });
  }, [lang]);

  useEffect(() => () => clients.current.forEach((c) => c.dispose()), []);

  return { client: (l: string) => clients.current.get(l), status: lang ? status[lang] ?? null : null };
}

/** Stand-in when the lsp submodule is off: no clients, no pill. */
export function useNoLsp(_tab: Tab, _lang: string | null): ReturnType<typeof useLsp> {
  return { client: () => undefined, status: null };
}

export function LspPill({ lang, status, onMissing }: { lang: string; status: LspStatus; onMissing: () => void }) {
  const label = { ready: `● ${status.name}`, connecting: `${status.name}…`, closed: <>{status.name} <CircleX size={12} /></>, missing: t("{name}: not installed", { name: status.name ?? lang }) }[status.state];
  const title =
    status.state === "ready"
      ? t(lang === "go" ? "Language server on: completion, hover, F12 go to definition, Shift+F12 references, gofmt on save" : "Language server on: completion, hover, F12 go to definition, Shift+F12 references")
      : status.hint ? t(status.hint) : t("The language server closed. Reload the tab to retry.");
  return (
    <span className={`lsp-pill ${status.state}`} title={title} onClick={() => status.state === "missing" && onMissing()}>
      {label}
    </span>
  );
}
