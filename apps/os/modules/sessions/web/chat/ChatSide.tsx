// The chat's side panel: live agents and subagents, the working-tree diff, review comments, recent commits, a
// feature doc, and whatever panels other modules add ("tab.side").
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { renderMarkdown } from "@os/lib/markdown";
import { slot } from "@os/registry";
import { projectsApi } from "../../../projects/web/api";
import { CommentBox } from "../review/CommentBox";
import { lineNumbers } from "../review/logic";
import { ReviewTray } from "../review/ReviewTray";
import { reviewActions, useReview } from "../review/store";
import type { Diff, Tab } from "../api";
import { Agents } from "../Agents";
import type { TabSideDef } from "../slots";
import type { TabStream } from "./useTabStream";
import { t } from "@os/i18n";

export function ChatSide({ tab, stream, openFeature }: { tab: Tab; stream: TabStream; openFeature: string | null }) {
  const { running, runningTasks, diff, refreshDiff, tasks, activity, liveModel, pendingPerms } = stream;
  const [side, setSide] = useState<string>("agents");
  const [featMd, setFeatMd] = useState("");
  const reviewCount = useReview(tab.id).length;
  const extra = slot<TabSideDef>("tab.side")
    .filter((s) => !s.when || s.when(tab))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

  useEffect(() => {
    if (!openFeature || !tab.project) return;
    projectsApi.feature(tab.project, openFeature).then((r) => {
      setFeatMd(r.markdown);
      setSide("feature");
    }, () => {});
  }, [openFeature, tab.project]);
  const Extra = extra.find((s) => s.id === side)?.component;

  return (
    <section className="side">
      <div className="side-tabs">
        <button className={side === "agents" ? "on" : ""} onClick={() => setSide("agents")}>
          {t("Agents")} {running && <span className="dot live" style={{ marginLeft: 4 }} />}
          {runningTasks > 0 && <span className="pill ok">{runningTasks}</span>}
        </button>
        <button className={side === "diff" ? "on" : ""} onClick={() => setSide("diff")}>
          {t("Changes")} {diff && diff.files.length + diff.untracked.length > 0 && <span className="pill accent">{diff.files.length + diff.untracked.length}</span>}
        </button>
        <button className={side === "review" ? "on" : ""} onClick={() => setSide("review")}>
          {t("Review")} {reviewCount > 0 && <span className="pill accent">{reviewCount}</span>}
        </button>
        <button className={side === "commits" ? "on" : ""} onClick={() => setSide("commits")}>Commits</button>
        {featMd && <button className={side === "feature" ? "on" : ""} onClick={() => setSide("feature")}>{t("Feature")}</button>}
        {extra.map((s) => <SideButton key={s.id} def={s} tab={tab} stream={stream} on={side === s.id} onClick={() => setSide(s.id)} />)}
        <span style={{ flex: 1 }} />
        <button onClick={refreshDiff} title={t("Refresh")} aria-label={t("Refresh")}><RefreshCw size={14} /></button>
      </div>
      <div className="side-body">
        {side === "agents" && (
          <Agents tabId={tab.id} tasks={tasks} running={running} activity={activity} model={liveModel} waitingPerm={pendingPerms > 0} />
        )}
        {side === "diff" && <DiffView tabId={tab.id} diff={diff} />}
        {side === "review" && <ReviewTray tabId={tab.id} refreshKey={diff?.diff} />}
        {side === "commits" && (
          <div className="commits">
            {diff?.commits.map((c) => (
              <div key={c.hash}>
                <span className="h">{c.hash}</span> {c.subject} <span className="faint">· {c.when}</span>
              </div>
            ))}
          </div>
        )}
        {side === "feature" && <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(featMd) }} />}
        {Extra && <Extra tab={tab} stream={stream} />}
      </div>
    </section>
  );
}

function SideButton({ def, tab, stream, on, onClick }: { def: TabSideDef; tab: Tab; stream: TabStream; on: boolean; onClick: () => void }) {
  const badge = def.useBadge?.(tab, stream) ?? null;
  return (
    <button className={on ? "on" : ""} onClick={onClick}>
      {t(def.label)} {badge ? <span className="pill accent">{badge}</span> : null}
    </button>
  );
}

function DiffView({ tabId, diff }: { tabId: string; diff: Diff | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null); // diff line index with the comment box open
  const comments = useReview(tabId);
  if (!diff) return <div className="empty"><span className="spin" /></div>;
  if (!diff.diff && diff.untracked.length === 0) return <div className="empty">{t("Clean working tree: no changes.")}</div>;
  const lines = diff.diff.split("\n");
  const nums = lineNumbers(lines);
  let curFile = "";
  return (
    <div ref={ref}>
      <div className="diff-files">
        {diff.files.map((f) => (
          <div
            key={f.file}
            className="f"
            onClick={() => ref.current?.querySelector(`[data-file="${CSS.escape(f.file)}"]`)?.scrollIntoView({ block: "start" })}
          >
            <span className="fn">{f.file}</span>
            <span className="add">+{f.add}</span>
            <span className="del">−{f.del}</span>
          </div>
        ))}
        {diff.untracked.map((f) => (
          <div key={f} className="f">
            <span className="fn">{f}</span>
            <span className="pill ok">{t("new")}</span>
          </div>
        ))}
      </div>
      <div className="diff">
        {lines.map((l, i) => {
          if (l.startsWith("diff --git")) {
            const file = l.split(" b/")[1] ?? l;
            curFile = file;
            return <div key={i} className="fh" data-file={file}>{file}</div>;
          }
          if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(l)) return null;
          const cls = l.startsWith("@@") ? "h" : l.startsWith("+") ? "a" : l.startsWith("-") ? "d" : "";
          const n = nums[i];
          const file = curFile;
          const snippet = l.slice(1);
          const has = n != null && comments.some((c) => c.path === file && c.line === n);
          return (
            <div key={i}>
              <div
                className={`l ${cls}${n != null ? " rv-can" : ""}${has ? " rv-has" : ""}`}
                {...(n != null ? { role: "button", tabIndex: 0, "aria-label": t("Comment on {where}", { where: `${file}:${n}` }), title: t("Comment on this line") } : {})}
                onClick={n != null ? () => setOpen(i) : undefined}
                onKeyDown={n != null ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(i)) : undefined}
              >
                {n != null && <span className="rv-plus-btn" aria-hidden>+</span>}
                {l || " "}
              </div>
              {open === i && n != null && (
                <CommentBox
                  anchor={`${file}:${n}`}
                  onCancel={() => setOpen(null)}
                  onSave={(text) => (reviewActions.add(tabId, { path: file, line: n, snippet, text }), setOpen(null))}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
