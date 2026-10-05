// Floating "Arquitecto": step-by-step advice (start / analyze) with file links, plus a small free chat.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Minus, MessageCircle, Send, Trash2, X } from "lucide-react";
import { archApi as api, type ArchAdvice, type ArchChatMsg } from "./api";
import type { Tab } from "../../sessions/web/api";
import { readLS, writeLS } from "@os/lib/storage";
import { md } from "./util";
import { language, t as tr } from "@os/i18n";

const errMsg = (e: unknown) => String((e as Error)?.message ?? e);

export function ArchAssistant({ tab, onOpenFile, lift = 0 }: { tab: Tab; lift?: number; onOpenFile: (path: string, line?: number) => void }) {
  const project = tab.project;
  const kOpen = `archOpen:${project}`;
  const kStep = `archStep:${project}`;
  const [open, setOpen] = useState(() => readLS(kOpen, false));
  const [step, setStep] = useState(() => readLS(kStep, 0));
  const [advice, setAdvice] = useState<ArchAdvice | null>(null);
  const [msgs, setMsgs] = useState<ArchChatMsg[]>([]);
  const [chat, setChat] = useState(false);
  const [busy, setBusy] = useState<null | "start" | "analyze">(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [chatErr, setChatErr] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!busy) return;
    setSecs(0);
    const t0 = Date.now();
    const id = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);
  const pos = { bottom: 20 + lift } as const;

  useEffect(() => {
    let live = true;
    api.get(project).then((d) => {
      if (!live) return;
      setAdvice(d.advice);
      setMsgs(d.chat);
    }, (e) => live && setError(errMsg(e)));
    return () => void (live = false);
  }, [project]);

  const setOpenP = (v: boolean) => (setOpen(v), writeLS(kOpen, v));
  const total = advice?.steps.length ?? 0;
  const cur = Math.min(Math.max(step, 0), Math.max(total - 1, 0));
  const goto = (i: number) => {
    const n = Math.min(Math.max(i, 0), Math.max(total - 1, 0));
    setStep(n);
    writeLS(kStep, n);
  };
  const s = advice?.steps[cur];

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [msgs, sending, chat, open]);

  async function advise(mode: "start" | "analyze") {
    setBusy(mode);
    setError("");
    try {
      const a = await api.advise(project, mode, language());
      setAdvice(a);
      goto(0);
      setChat(false);
    } catch (e) {
      setError((e as { status?: number }).status === 409 ? tr("There is already an analysis running for this project. Wait for it to finish.") : errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setChatErr("");
    setText("");
    setMsgs((m) => [...m, { role: "user", text: message, at: new Date().toISOString() }]);
    try {
      const r = await api.chat(project, message, language());
      setMsgs(r.messages);
    } catch (e) {
      setChatErr(errMsg(e));
      setText(message);
      setMsgs((m) => m.slice(0, -1));
    } finally {
      setSending(false);
    }
  }

  async function clear() {
    setChatErr("");
    try {
      await api.clearChat(project);
      setMsgs([]);
      setClearing(false);
    } catch (e) {
      setChatErr(errMsg(e));
    }
  }

  if (!open) {
    return (
      <button className="arch-pill" style={pos} onClick={() => setOpenP(true)} aria-label={advice ? tr("Open the Architect (there is advice)") : tr("Open the Architect")}>
        <span>{tr("Architect")}</span>
        {advice && <span className="arch-dot" aria-hidden />}
      </button>
    );
  }

  return (
    <section className="arch-float card" style={pos} role="region" aria-label={tr("Architect")}>
      <header className="arch-float-head">
        <strong>{tr("Architect")}</strong>
        <button className="btn sm arch-close" aria-label={tr("Close the Architect (it stays as a button)")} title={tr("Close")} onClick={() => setOpenP(false)}><Minus size={14} /> {tr("Close")}</button>
      </header>

      {!!tab.meta?.archOff && <p className="faint arch-off">{tr("The agent does not follow it in this tab")}</p>}

      {chat ? (
        <div className="arch-float-body arch-chat">
          <div className="arch-log" ref={logRef} aria-live="polite">
            {msgs.length === 0 && !sending && <p className="faint">{tr("Ask anything about the architecture or where to go next.")}</p>}
            {msgs.map((m, i) => (
              <div key={i} className={`arch-bubble ${m.role}`}>
                {m.role === "assistant" ? <div className="md" dangerouslySetInnerHTML={{ __html: md(m.text) }} /> : m.text}
              </div>
            ))}
            {sending && <div className="arch-bubble assistant"><span className="spin" /> {tr("thinking…")}</div>}
          </div>
          {chatErr && <p className="dk-warn" role="alert">{chatErr}</p>}
          <div className="arch-compose">
            <textarea
              className="field"
              rows={2}
              value={text}
              disabled={sending}
              aria-label={tr("Message for the Architect")}
              placeholder={tr("Write your question… (Enter sends, Shift+Enter new line)")}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) (e.preventDefault(), send());
              }}
            />
            <div className="arch-compose-btns">
              <button className="btn sm primary" onClick={send} disabled={sending || !text.trim()}><Send size={13} /> {tr("Send")}</button>
              {clearing ? (
                <>
                  <button className="btn sm danger armed" onClick={clear} aria-label={tr("Confirm: clear the conversation")}>{tr("Clear?")}</button>
                  <button className="btn sm ghost" onClick={() => setClearing(false)}><X size={13} /> No</button>
                </>
              ) : (
                <button className="btn sm ghost" onClick={() => setClearing(true)} disabled={sending || msgs.length === 0}><Trash2 size={13} /> {tr("Clear")}</button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="arch-float-body arch-steps"
          tabIndex={0}
          aria-label={tr("Architect steps (left and right arrows to move)")}
          onKeyDown={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest("input,textarea,select")) return;
            if (e.key === "ArrowLeft") (e.preventDefault(), goto(cur - 1));
            else if (e.key === "ArrowRight") (e.preventDefault(), goto(cur + 1));
          }}
        >
          {busy ? (
            <p className="arch-busy" role="status" aria-live="polite"><span className="spin" /> {tr("The agent is looking at the code… {secs} s", { secs })}</p>
          ) : advice && s ? (
            <>
              {cur === 0 && advice.summary && <div className="md arch-summary" dangerouslySetInnerHTML={{ __html: md(advice.summary) }} />}
              <div className="arch-step-nav">
                <button className="btn sm ghost" aria-label={tr("Previous step")} disabled={cur === 0} onClick={() => goto(cur - 1)}><ChevronLeft size={16} /></button>
                <span className="pill accent" aria-live="polite">{tr("Step {n}/{total}", { n: cur + 1, total })}</span>
                <button className="btn sm ghost" aria-label={tr("Next step")} disabled={cur >= total - 1} onClick={() => goto(cur + 1)}><ChevronRight size={16} /></button>
              </div>
              <h4 className="arch-step-title">{s.title}</h4>
              <div className="md arch-detail" dangerouslySetInnerHTML={{ __html: md(s.detail) }} />
              {s.files.length > 0 && (
                <div className="arch-chips">
                  {s.files.map((f) => (
                    <button key={f} className="pill info arch-chip mono" title={tr("Open {file} in the Editor", { file: f })} onClick={() => onOpenFile(f)}><FileText size={12} /> {f}</button>
                  ))}
                </div>
              )}
            </>
          ) : advice ? (
            <div className="md arch-summary" dangerouslySetInnerHTML={{ __html: md(advice.summary || tr("No steps for now.")) }} />
          ) : (
            <p className="faint">{tr("No advice yet. “How do I start” lays out the steps to put this architecture in place; “Analyze” compares the current code with it.")}</p>
          )}
          {error && <p className="dk-warn" role="alert">{error}</p>}
        </div>
      )}

      <footer className="arch-float-foot">
        <button className="btn sm" onClick={() => advise("start")} disabled={!!busy}>{busy === "start" && <span className="spin" />} {tr("How do I start")}</button>
        <button className="btn sm" onClick={() => advise("analyze")} disabled={!!busy}>{busy === "analyze" && <span className="spin" />} {tr("Analyze")}</button>
        <button className={`btn sm${chat ? " primary" : ""}`} aria-pressed={chat} onClick={() => setChat((c) => !c)}><MessageCircle size={13} /> Chat</button>
      </footer>
    </section>
  );
}
