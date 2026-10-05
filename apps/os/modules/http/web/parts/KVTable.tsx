// Key/value rows (headers, environment variables) with an always-present blank row to add the next one.
import { X } from "lucide-react";
import type { KV } from "../api";
import { t } from "@os/i18n";

export function KVTable({ rows, onChange, keyPh, valPh }: { rows: KV[]; onChange: (r: KV[]) => void; keyPh: string; valPh: string }) {
  // Always one trailing blank row, so typing in it adds a new entry.
  const shown = [...rows, { k: "", v: "", on: true }];
  const set = (i: number, p: Partial<KV>) => {
    const next = shown.map((r, j) => (j === i ? { ...r, ...p } : r));
    onChange(next.filter((r, j) => j < rows.length || r.k || r.v));
  };
  return (
    <div className="kv">
      {shown.map((r, i) => (
        <div key={i} className={`kv-row ${r.on ? "" : "off"}`}>
          <input type="checkbox" checked={r.on} disabled={i === rows.length} onChange={(e) => set(i, { on: e.target.checked })} />
          <input className="field mono" placeholder={keyPh} value={r.k} onChange={(e) => set(i, { k: e.target.value })} />
          <input className="field mono" placeholder={valPh} value={r.v} onChange={(e) => set(i, { v: e.target.value })} />
          {i < rows.length ? <button className="kv-x" title={t("Remove")} aria-label={t("Remove")} onClick={() => onChange(rows.filter((_, j) => j !== i))}><X size={14} /></button> : <span />}
        </div>
      ))}
    </div>
  );
}
