// Plan usage at the bottom of the rail: the 5-hour session and the weekly limit as two thin bars.
// Real % comes from the claude.ai plan (server/limits.ts); without it the bars hide and tokens / $ are shown.
import { useEffect, useRef, useState } from "react";
import { locale } from "@os/i18n";
import { ktok, usd } from "@os/lib/format";
import { readStr, writeStr } from "@os/lib/storage";
import { t } from "@os/i18n";

type Win = { id: "five_hour" | "seven_day"; label: string; pct: number | null; resetsAt: number | null; source: "plan" | "local"; tokens: number; cost: number; messages: number };
type Limits = { at: number; subscription: string | null; planAvailable: boolean | null; windows: Win[] };

const WARN = 80;
const BAD = 90;
const level = (pct: number | null) => (pct === null ? "" : pct >= BAD ? "bad" : pct >= WARN ? "warn" : "ok");

/** "in 2 h 10 min" / "in 3 d 4 h" until a reset. */
function until(ms: number) {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60_000));
  if (m < 60) return t("in {m} min", { m });
  if (m < 2880) return t("in {h} h {m} min", { h: Math.floor(m / 60), m: m % 60 });
  return t("in {d} d {h} h", { d: Math.floor(m / 1440), h: Math.floor((m % 1440) / 60) });
}

const tip = (w: Win) =>
  [
    w.pct !== null ? t("{label}: {pct}% of the plan used", { label: t(w.label), pct: Math.round(w.pct) }) : t("{label}: plan % unknown (local data only)", { label: t(w.label) }),
    w.resetsAt ? `${w.source === "plan" ? t("Resets") : t("Would reset (estimate)")} ${until(w.resetsAt)} · ${new Date(w.resetsAt).toLocaleString(locale(), { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "",
    t("{tokens} tokens · ~{cost} (estimated at API prices) · {n} messages", { tokens: ktok(w.tokens), cost: usd(w.cost), n: w.messages }),
    w.pct !== null && w.pct >= WARN ? (w.pct >= BAD ? t("Over 90%: better to stop.") : t("Over 80%.")) : "",
  ].filter(Boolean).join("\n");

export function UsageMeter() {
  const [data, setData] = useState<Limits | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/limits")
        .then((r) => (r.ok ? (r.json() as Promise<Limits>) : null))
        .then((d) => live && d && setData(d))
        .catch(() => {});
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  // One warning per window per level (80, then 90), remembered across reloads until that window resets.
  useEffect(() => {
    if (!data) return;
    for (const w of data.windows) {
      if (w.source !== "plan" || w.pct === null || w.pct < WARN) continue;
      const lvl = w.pct >= BAD ? BAD : WARN;
      const key = `usage-warn:${w.id}:${lvl}:${Math.floor((w.resetsAt ?? 0) / 60_000 / 30)}`;
      if (readStr(key)) continue;
      writeStr(key, "1");
      if (first.current) continue; // already over the line when the app opened: show the bar, don't nag
      const msg = w.id === "five_hour"
        ? t(lvl >= BAD ? "You've used {pct}% of your 5 h session: better to stop" : "You've used {pct}% of your 5 h session", { pct: lvl })
        : t(lvl >= BAD ? "You've used {pct}% of your weekly limit: better to stop" : "You've used {pct}% of your weekly limit", { pct: lvl });
      setToast(msg);
      setTimeout(() => setToast(null), 12_000);
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("agent-os-nexo", { body: msg });
      } catch {}
    }
    first.current = false;
  }, [data]);

  if (!data) return null;
  return (
    <>
      <div className="usage" role="group" aria-label={t("Plan usage")}>
        {data.windows.map((w) => (
          <div key={w.id} className={`usage-row ${level(w.pct)}`} title={tip(w)} tabIndex={0} aria-label={tip(w).replace(/\n/g, ". ")}>
            <span className="usage-label">{t(w.label)}</span>
            {w.pct !== null ? (
              <>
                <span className="usage-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.pct)}>
                  <i style={{ width: `${Math.max(2, w.pct)}%` }} />
                </span>
                <span className="usage-val">{Math.round(w.pct)}%</span>
              </>
            ) : (
              <span className="usage-val">{ktok(w.tokens)}</span>
            )}
          </div>
        ))}
      </div>
      {toast && (
        <div className="usage-toast" role="status" aria-live="polite">
          {toast}
          <button onClick={() => setToast(null)} aria-label={t("Close notice")}>×</button>
        </div>
      )}
    </>
  );
}
