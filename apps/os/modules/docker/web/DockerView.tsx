// Docker rail view: the engine's containers and images, plus logs and shells in a bottom drawer.
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Terminal } from "lucide-react";
import { t } from "@os/i18n";
import { dockerApi as api, type Container, type Image, type TermInfo } from "./api";
import { DockerContainers } from "./DockerContainers";
import { DockerImages } from "./DockerImages";
import { DockerDrawer, type Drawer } from "./DockerDrawer";

type Info = Awaited<ReturnType<typeof api.info>>;

export function DockerView() {
  const [info, setInfo] = useState<Info | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [terms, setTerms] = useState<TermInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(new Set<string>());
  const fail = useCallback((msg: string) => setError(msg), []);

  const reqId = useRef(0); // only the latest container response may set state
  const fetchContainers = useCallback(async (onErr: (msg: string) => void) => {
    const n = ++reqId.current;
    try {
      const list = await api.containers();
      if (n === reqId.current) setContainers(list);
    } catch (e) {
      if (n === reqId.current) onErr((e as Error).message);
    }
  }, []);
  const loadContainers = useCallback(() => fetchContainers(fail), [fetchContainers, fail]);
  const loadImages = useCallback(() => api.images().then(setImages, (e) => fail(e.message)), [fail]);

  async function refreshAll() {
    setRefreshing(true);
    setError("");
    try {
      const i = await api.info();
      setInfo(i);
      if (i.ok) await Promise.all([loadContainers(), loadImages()]);
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refreshAll();
    // Shells live on the server: pick them back up after switching views.
    api.terms().then((list) => {
      setTerms(list);
      setActive(list[list.length - 1]?.id ?? null);
      if (list.length) setDrawer({ mode: "shell" });
    }, (e) => fail(e.message));
  }, []);

  useEffect(() => {
    if (!info?.ok) return;
    const timer = setInterval(() => {
      // A failing poll means the engine went away: show the "not reachable" screen instead of a banner every 5 s.
      if (busy.current.size === 0) {
        void fetchContainers((error) =>
          setInfo((prev) => ({ ok: false, cli: prev?.cli ?? { found: false, version: null }, error })),
        );
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [info?.ok, fetchContainers]);

  async function openShell(c: Container) {
    try {
      const term = await api.shell(c.name);
      setTerms((l) => [...l, term]);
      setActive(term.id);
      setDrawer({ mode: "shell" });
    } catch (e) {
      fail((e as Error).message);
    }
  }

  async function closeTerm(id: string) {
    try {
      await api.killTerm(id);
      const list = await api.terms();
      setTerms(list);
      setActive((a) => (a && list.some((x) => x.id === a) ? a : list[list.length - 1]?.id ?? null));
    } catch (e) {
      fail((e as Error).message);
    }
  }

  return (
    <div className="dk">
      <div className="page dk-main">
        <div className="dk-top">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1>Docker</h1>
            {info === null ? (
              <p className="sub"><span className="spin" /> {t("Connecting to Docker…")}</p>
            ) : (
              <>
                {/* CLI status card — always visible: the CLI is the product, the daemon is a softer signal. */}
                <div
                  className="sub"
                  style={{
                    display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                    border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", marginBottom: 12,
                  }}
                >
                  <span className="eyebrow">{t("Docker CLI")}</span>
                  <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {info.cli?.version ?? t("CLI not found")}
                  </span>
                  <span className={info.cli?.found ? "pill ok" : "pill bad"}>
                    {info.cli?.found ? t("Available") : t("Not available")}
                  </span>
                </div>
                {info.ok ? (
                  <p className="sub">{t("Docker {version} · context {context}", { version: info.version ?? "", context: info.context ?? "" })}</p>
                ) : (
                  <div className="sub">
                    <div className="errline">{t("Docker is not reachable: {error}", { error: info.error ?? "" })}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {info.action === "open-desktop" && (
                        <button
                          className="btn sm"
                          disabled={refreshing}
                          onClick={() => api.openDesktop().then(() => refreshAll(), (e) => fail((e as Error).message))}
                        >
                          {t("Open Docker Desktop")}
                        </button>
                      )}
                      <button className="btn sm" disabled={refreshing} onClick={refreshAll}>{t("Retry")}</button>
                    </div>
                    {info.action === "install-cli" && (
                      <div className="faint" style={{ marginTop: 8 }}>{t("Install Docker with: {command}", { command: info.installHint ?? "" })}</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <button className="btn sm ghost" title={t("Refresh")} aria-label={t("Refresh Docker")} disabled={refreshing} onClick={refreshAll}>
            {refreshing ? <span className="spin" /> : <RefreshCw size={16} />}
          </button>
        </div>
        {error && (
          <div className="errline dk-err">
            <span>{error}</span>
            <button className="linkish" aria-label={t("Dismiss the error")} onClick={() => setError("")}>{t("close")}</button>
          </div>
        )}
        {info?.ok && (
          <>
            <DockerContainers
              containers={containers}
              reload={loadContainers}
              busyRef={busy}
              fail={fail}
              onLogs={(c) => setDrawer({ mode: "logs", id: c.id, name: c.name })}
              onShell={openShell}
            />
            <DockerImages images={images} reload={() => Promise.all([loadImages(), loadContainers()])} fail={fail} />
          </>
        )}
      </div>
      {!drawer && terms.length > 0 && (
        <button className="dk-reopen" onClick={() => setDrawer({ mode: "shell" })}>
          <Terminal size={14} /> {t("Open terminals · {n}", { n: terms.length })}
        </button>
      )}
      {drawer && <DockerDrawer drawer={drawer} setDrawer={setDrawer} terms={terms} active={active} setActive={setActive} closeTerm={closeTerm} fail={fail} />}
    </div>
  );
}
