// The dictionary: a searchable list of your terms on the left, the selected term (or a new one) on the right.
// Everything is saved in library/dictionary/, where every agent reads it; agents also add terms when you tell them.
import { BookA, Plus, Save, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { t } from "@os/i18n";
import { ConfirmDelete } from "@os/lib/ConfirmDelete";
import { dictionaryApi as api, type Term } from "./api";

type Draft = { term: string; summary: string; aliases: string; body: string };
const EMPTY: Draft = { term: "", summary: "", aliases: "", body: "" };
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function Dictionary() {
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null); // current name of the term open, null = new
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saved, setSaved] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.list().then(setTerms, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  async function open(term: string | null) {
    setError("");
    if (term === null) {
      setSelected(null);
      setDraft(EMPTY);
      setSaved(EMPTY);
      return;
    }
    try {
      const full = await api.show(term);
      const d = { term: full.term, summary: full.summary, aliases: full.aliases.join(", "), body: full.body ?? "" };
      setSelected(full.term);
      setDraft(d);
      setSaved(d);
    } catch (e) {
      setError(t((e as Error).message));
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    const input = {
      term: draft.term.trim(),
      summary: draft.summary.trim(),
      aliases: draft.aliases.split(",").map((a) => a.trim()).filter(Boolean),
      body: draft.body,
    };
    try {
      const out = selected === null ? await api.create(input) : await api.update(selected, input);
      await load();
      await open(out.term);
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (selected === null) return;
    setError("");
    try {
      await api.remove(selected);
      await load();
      await open(null);
    } catch (e) {
      setError(t((e as Error).message));
    }
  }

  const shown = useMemo(() => {
    const needle = fold(q.trim());
    if (!terms) return [];
    if (!needle) return terms;
    return terms.filter((x) => [x.term, x.summary, ...x.aliases].some((s) => fold(s).includes(needle)));
  }, [terms, q]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const canSave = draft.term.trim() !== "" && draft.summary.trim() !== "" && dirty && !busy;

  return (
    <div className="dict">
      <aside className="dict-side">
        <div className="dict-head">
          <h1>{t("Dictionary")}</h1>
          <button className="btn sm primary" onClick={() => void open(null)}><Plus size={13} /> {t("New term")}</button>
        </div>
        <p className="faint dict-hint">{t("Your concepts, read by every agent. Tell an agent \"save this concept\" and it lands here too.")}</p>
        <label className="dict-search">
          <Search size={14} />
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search terms")} aria-label={t("Search terms")} />
        </label>
        <div className="dict-list" role="listbox" aria-label={t("Terms")}>
          {terms === null && !error && <div className="faint dict-empty">{t("Loading…")}</div>}
          {terms?.length === 0 && <div className="faint dict-empty">{t("No terms yet. Add the first one.")}</div>}
          {terms && terms.length > 0 && shown.length === 0 && <div className="faint dict-empty">{t("No term matches.")}</div>}
          {shown.map((x) => (
            <button key={x.path} role="option" aria-selected={selected === x.term} className={`dict-item${selected === x.term ? " on" : ""}`} onClick={() => void open(x.term)}>
              <b>{x.term}</b>
              <span>{x.summary}</span>
              {x.aliases.length > 0 && <small className="mono">{x.aliases.join(" · ")}</small>}
            </button>
          ))}
        </div>
      </aside>

      <section className="dict-main">
        {error && <div className="errline" role="alert">{error}</div>}
        <div className="dict-form card">
          <div className="dict-form-head">
            <span className="eyebrow"><BookA size={12} /> {selected === null ? t("New term") : t("Edit term")}</span>
            {selected !== null && <ConfirmDelete name={selected} title={t("Delete this term")} onConfirm={() => void remove()} />}
          </div>
          <label>
            <span>{t("Term")}</span>
            <input className="field" value={draft.term} maxLength={80} onChange={(e) => setDraft({ ...draft, term: e.target.value })} placeholder={t("e.g. Active customer")} />
          </label>
          <label>
            <span>{t("Summary")} <small className="faint">{t("one line: what it means")}</small></span>
            <input className="field" value={draft.summary} maxLength={240} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} placeholder={t("e.g. Bought in the last 90 days")} />
          </label>
          <label>
            <span>{t("Aliases")} <small className="faint">{t("other names, separated by commas")}</small></span>
            <input className="field" value={draft.aliases} onChange={(e) => setDraft({ ...draft, aliases: e.target.value })} placeholder={t("e.g. active, current customer")} />
          </label>
          <label>
            <span>{t("Definition")} <small className="faint">{t("details, examples, rules (optional)")}</small></span>
            <textarea className="field" rows={10} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </label>
          <div className="dict-actions">
            {selected !== null && dirty && <button className="btn sm ghost" onClick={() => setDraft(saved)}>{t("Discard changes")}</button>}
            <button className="btn primary" disabled={!canSave} onClick={() => void save()}><Save size={14} /> {busy ? t("Saving…") : t("Save")}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
