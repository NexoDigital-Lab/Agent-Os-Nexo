import { Cloud, RefreshCw, Tag, X } from "lucide-react";
import { ago } from "@os/lib/format";
import { useEffect, useMemo, useState } from "react";
import { BranchIcon } from "@os/lib/icons";
import type { TabViewProps } from "../../../../sessions/web/slots";
import { usePalette, laneColors } from "../../../../themes/web/theme";
import { editorApi as api, type Commit, type CommitDetail, type Ref } from "../../../web/api";
import { t } from "@os/i18n";

const ROW = 26;
const COL = 14;
// Lane colors come from the active palette (themes module); set once per render of the graph.
let LANE_COLORS: string[] = [];
const color = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length]!;

type Edge = { from: number; to: number; half: "top" | "bottom" | "full"; color: string };
type Row = { c: Commit; col: number; edges: Edge[] };

/**
 * Assigns each commit a column. `lanes[i]` is the hash that column is waiting for; columns never shift,
 * so a branch keeps its lane (and color) all the way down. A merge opens lanes for its extra parents.
 */
function layout(commits: Commit[]): { rows: Row[]; width: number } {
  const lanes: (string | null)[] = [];
  const laneColor: number[] = [];
  let colorSeq = 0;
  let width = 1;
  const free = () => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.length : i;
  };
  const rows = commits.map((c) => {
    const edges: Edge[] = [];
    let col = lanes.indexOf(c.hash);
    if (col === -1) {
      col = free();
      laneColor[col] = colorSeq++;
    }
    // Top half: lanes converging into this commit, and everything else passing straight through.
    lanes.forEach((h, i) => {
      if (h === c.hash) edges.push({ from: i, to: col, half: "top", color: color(laneColor[i]) });
    });
    const through = lanes.map((h, i) => (h && h !== c.hash ? i : -1)).filter((i) => i >= 0);
    lanes.forEach((h, i) => { if (h === c.hash) lanes[i] = null; });
    // Bottom half: first parent continues this lane, extra parents join an existing lane or open one.
    c.parents.forEach((p, k) => {
      let j = lanes.indexOf(p);
      if (j === -1) {
        j = k === 0 ? col : free();
        lanes[j] = p;
        if (k > 0) laneColor[j] = colorSeq++;
      }
      edges.push({ from: col, to: j, half: "bottom", color: color(laneColor[k === 0 ? col : j]) });
    });
    for (const i of through) edges.push({ from: i, to: i, half: "full", color: color(laneColor[i]) });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    width = Math.max(width, lanes.length, col + 1);
    return { c, col, edges };
  });
  return { rows, width };
}

const x = (col: number) => COL / 2 + col * COL + 4;

function GraphCell({ row, width, head }: { row: Row; width: number; head: boolean }) {
  const mid = ROW / 2;
  const merge = row.c.parents.length > 1;
  return (
    <svg className="gg-svg" width={width * COL + 8} height={ROW}>
      {row.edges.map((e, i) => {
        const [y1, y2] = e.half === "top" ? [0, mid] : e.half === "bottom" ? [mid, ROW] : [0, ROW];
        if (e.from === e.to) return <line key={i} x1={x(e.from)} y1={y1} x2={x(e.to)} y2={y2} stroke={e.color} strokeWidth={2} />;
        // Curve between lanes, bending at the commit's row.
        const d = e.half === "top"
          ? `M${x(e.from)} ${y1} C${x(e.from)} ${mid} ${x(e.to)} ${y1} ${x(e.to)} ${y2}`
          : `M${x(e.from)} ${y1} C${x(e.from)} ${ROW} ${x(e.to)} ${mid} ${x(e.to)} ${y2}`;
        return <path key={i} d={d} fill="none" stroke={e.color} strokeWidth={2} />;
      })}
      <circle
        cx={x(row.col)}
        cy={mid}
        r={head ? 5.5 : merge ? 3.5 : 4.5}
        fill={head ? "var(--bg)" : row.edges.find((e) => e.half === "bottom")?.color ?? color(0)}
        stroke={row.edges.find((e) => e.half === "bottom")?.color ?? color(0)}
        strokeWidth={head ? 2.5 : 1.5}
      />
    </svg>
  );
}

const REF_ICON = { head: <BranchIcon />, local: <BranchIcon />, remote: <Cloud size={12} />, tag: <Tag size={12} /> };

function RefPill({ r }: { r: Ref }) {
  return <span className={`gg-ref ${r.kind}`} title={{ head: "Rama actual (HEAD)", local: "Rama local", remote: "Rama remota", tag: "Tag" }[r.kind]}>{REF_ICON[r.kind]} {r.name}</span>;
}

function DiffView({ text }: { text: string }) {
  return (
    <pre className="gg-diff mono">
      {text.split("\n").map((l, i) => {
        const cls = l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ") ? "meta"
          : l.startsWith("@@") ? "hunk" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "";
        return <div key={i} className={cls}>{l || " "}</div>;
      })}
    </pre>
  );
}

export function GitGraph({ tab }: TabViewProps) {
  LANE_COLORS = laneColors(usePalette());
  const [data, setData] = useState<{ branch: string; commits: Commit[] } | null>(null);
  const [all, setAll] = useState(true);
  const [limit, setLimit] = useState(400);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [file, setFile] = useState<{ name: string; diff: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api.gitGraph(tab.id, all, limit)
      .then((d) => { setData(d); setError(""); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [tab.id, all, limit]);

  useEffect(() => {
    setDetail(null);
    setFile(null);
    if (sel) api.gitCommit(tab.id, sel).then(setDetail).catch((e) => setError(e.message));
  }, [sel]);

  const { rows, width } = useMemo(() => layout(data?.commits ?? []), [data]);
  const needle = q.trim().toLowerCase();
  const match = (c: Commit) => !needle || `${c.subject} ${c.author} ${c.hash} ${c.refs.map((r) => r.name).join(" ")}`.toLowerCase().includes(needle);
  const headHash = data?.commits.find((c) => c.refs.some((r) => r.kind === "head"))?.hash;

  async function openFile(name: string) {
    if (!sel) return;
    if (file?.name === name) return setFile(null);
    try {
      setFile({ name, diff: (await api.gitDiff(tab.id, sel, name)).diff });
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className={`gg ${sel ? "with-detail" : ""}`}>
      <section className="gg-main">
        <div className="gg-bar">
          <span className="gg-ref head"><BranchIcon /> {data?.branch || t("(no branch)")}</span>
          <div className="seg">
            <button className={all ? "on" : ""} onClick={() => setAll(true)}>{t("All branches")}</button>
            <button className={!all ? "on" : ""} onClick={() => setAll(false)}>{t("Only the current one")}</button>
          </div>
          <input className="field gg-search" placeholder={t("Search message, author, hash, branch…")} value={q} onChange={(e) => setQ(e.target.value)} />
          <span style={{ flex: 1 }} />
          <span className="faint mono" style={{ fontSize: 11.5 }}>{data ? `${data.commits.length} commits` : ""}</span>
          <button className="btn sm ghost" title={t("Reload")} onClick={load}>{loading ? <span className="spin" /> : <RefreshCw size={14} />}</button>
        </div>
        {error && <div className="errline" style={{ padding: "8px 14px" }}>{error}</div>}
        <div className="gg-list">
          {data && data.commits.length === 0 && <div className="empty" style={{ marginTop: 60 }}>{t("This repository has no commits yet.")}</div>}
          {rows.map((row) => (
            <div
              key={row.c.hash}
              className={`gg-row ${sel === row.c.hash ? "on" : ""} ${match(row.c) ? "" : "dim"}`}
              onClick={() => setSel(sel === row.c.hash ? null : row.c.hash)}
            >
              <GraphCell row={row} width={width} head={row.c.hash === headHash} />
              <div className="gg-msg">
                {row.c.refs.map((r) => <RefPill key={r.kind + r.name} r={r} />)}
                <span className={row.c.parents.length > 1 ? "faint" : ""}>{row.c.subject}</span>
              </div>
              <span className="gg-author">{row.c.author}</span>
              <span className="gg-when faint">{ago(row.c.time)}</span>
              <span className="gg-hash mono faint">{row.c.hash.slice(0, 7)}</span>
            </div>
          ))}
          {data && data.commits.length >= limit && (
            <button className="btn sm ghost gg-more" onClick={() => setLimit(limit + 400)}>{t("Load 400 more")}</button>
          )}
        </div>
      </section>

      {sel && (
        <aside className="gg-detail">
          {!detail ? (
            <span className="spin" />
          ) : (
            <>
              <div className="gg-dhead">
                <span className="mono faint">{detail.hash.slice(0, 10)}</span>
                <button className="btn sm ghost" onClick={() => navigator.clipboard.writeText(detail.hash)}>{t("Copy hash")}</button>
                <button className="btn sm ghost" onClick={() => setSel(null)}><X size={14} /></button>
              </div>
              <pre className="gg-body">{detail.body}</pre>
              <div className="faint" style={{ fontSize: 12.5 }}>
                {detail.author} · {new Date(detail.time).toLocaleString("es-AR")}
              </div>
              <div className="eyebrow" style={{ margin: "14px 0 6px" }}>
                {detail.files.length} archivos · <span className="add-n">+{detail.files.reduce((s, f) => s + f.add, 0)}</span>{" "}
                <span className="del-n">−{detail.files.reduce((s, f) => s + f.del, 0)}</span>
              </div>
              {detail.files.map((f) => (
                <div key={f.file}>
                  <div className={`gg-file ${file?.name === f.file ? "on" : ""}`} onClick={() => openFile(f.file)} title={f.file}>
                    <span className="nm mono">{f.file}</span>
                    {f.binary ? <span className="faint">bin</span> : <><span className="add-n">+{f.add}</span><span className="del-n">−{f.del}</span></>}
                  </div>
                  {file?.name === f.file && <DiffView text={file.diff} />}
                </div>
              ))}
            </>
          )}
        </aside>
      )}
    </div>
  );
}
