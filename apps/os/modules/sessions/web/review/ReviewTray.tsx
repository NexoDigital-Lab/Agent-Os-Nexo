// The "Review" tray: the tab's pending comments (edit / remove) and the button that composes ONE chat message.
import { MessageSquareText, Trash2, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { call } from "@os/lib/http";
import { CommentBox } from "./CommentBox";
import { composeReview, resolveLine, type LineState } from "./logic";
import { reviewActions, sendDraft, useReview } from "./store";
import { t } from "@os/i18n";

export function ReviewTray({ tabId, refreshKey }: { tabId: string; refreshKey?: unknown }) {
  const comments = useReview(tabId);
  const [editing, setEditing] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string[] | null>>({});

  const paths = useMemo(() => [...new Set(comments.map((c) => c.path))].sort().join("\n"), [comments]);
  // Re-read the files whenever the tray or the diff changes (the agent may have edited them since).
  useEffect(() => {
    let live = true;
    Promise.all(
      (paths ? paths.split("\n") : []).map((p) =>
        // The editor module serves files; without it the tray just can't tell whether a line moved.
        call<{ exists: boolean; content: string }>("GET", `/api/tabs/${tabId}/file?path=${encodeURIComponent(p)}`)
          .then((r) => [p, r.exists ? r.content.split("\n") : []] as const, () => [p, null] as const),
      ),
    ).then((rows) => live && setFiles(Object.fromEntries(rows)));
    return () => void (live = false);
  }, [tabId, paths, refreshKey]);

  const states: Record<string, LineState> = {};
  for (const c of comments) states[c.id] = resolveLine(c, files[c.path] ?? null);

  if (comments.length === 0)
    return <div className="empty">{t("No comments. In Changes, click a line (or press Enter on it) to comment it.")}</div>;

  return (
    <div className="rv-tray">
      <ol className="rv-list">
        {comments.map((c) => (
          <li key={c.id} className="rv-item">
            <div className="rv-head">
              <span className="mono rv-loc">{c.path}:{states[c.id]!.line}</span>
              {states[c.id]!.moved && <span className="pill bad" title={t("The text of that line changed since you commented")}>{t("line moved")}</span>}
              <span style={{ flex: 1 }} />
              <button className="btn sm ghost" aria-label={t("Edit comment")} onClick={() => setEditing(c.id)}><Pencil size={13} /></button>
              <button className="btn sm ghost danger" aria-label={t("Remove comment")} onClick={() => reviewActions.remove(tabId, c.id)}><Trash2 size={13} /></button>
            </div>
            {c.snippet.trim() && <div className="rv-quote mono">{c.snippet.trim()}</div>}
            {editing === c.id ? (
              <CommentBox anchor={`${c.path}:${c.line}`} initial={c.text} onCancel={() => setEditing(null)} onSave={(text) => (reviewActions.edit(tabId, c.id, text), setEditing(null))} />
            ) : (
              <div className="rv-text">{c.text}</div>
            )}
          </li>
        ))}
      </ol>
      <div className="rv-foot">
        <button className="btn sm ghost danger" onClick={() => reviewActions.clear(tabId)}>{t("Clear")}</button>
        <button
          className="btn primary"
          onClick={() => {
            sendDraft(tabId, composeReview(comments, states));
            reviewActions.clear(tabId);
          }}
        >
          <MessageSquareText size={14} /> {t("Send the review to the chat ({n})", { n: comments.length })}
        </button>
      </div>
    </div>
  );
}
