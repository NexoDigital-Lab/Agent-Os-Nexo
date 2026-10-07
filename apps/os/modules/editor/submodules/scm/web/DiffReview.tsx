// Monaco diff with review comments: click the gutter (hover shows "+") or press Ctrl+Alt+M on the cursor line to
// comment the line of the modified side. The tray (count badge) opens as a full-width drawer under the diff.
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { ClipboardList } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Tab } from "../../../web/api";
import { languageOf } from "../../../web/monaco";
import { CommentBox } from "../../../../sessions/web/review/CommentBox";
import { ReviewTray } from "../../../../sessions/web/review/ReviewTray";
import { reviewActions, useReview } from "../../../../sessions/web/review/store";
import { t } from "@os/i18n";

export function DiffReview({ tab, path, original, modified, staged }: { tab: Tab; path: string; original: string; modified: string; staged: boolean }) {
  const comments = useReview(tab.id);
  const [draft, setDraft] = useState<{ line: number; snippet: string } | null>(null);
  const [tray, setTray] = useState(false);
  const ed = useRef<any>(null);
  const deco = useRef<any>(null);
  const hover = useRef<any>(null);
  const mine = comments.filter((c) => c.path === path);

  const onMount: DiffOnMount = (editor, monaco) => {
    const m = editor.getModifiedEditor();
    ed.current = m;
    m.updateOptions({ glyphMargin: true });
    deco.current = m.createDecorationsCollection();
    hover.current = m.createDecorationsCollection();
    const open = (line: number) => setDraft({ line, snippet: m.getModel()?.getLineContent(line) ?? "" });
    m.onMouseMove((e) => {
      const t = e.target.type;
      const on = t === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || t === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS;
      const ln = e.target.position?.lineNumber;
      hover.current.set(on && ln ? [{ range: new monaco.Range(ln, 1, ln, 1), options: { glyphMarginClassName: "rv-plus" } }] : []);
    });
    m.onMouseLeave(() => hover.current.set([]));
    m.onMouseDown((e) => {
      const t = e.target.type;
      if ((t === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || t === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) && e.target.position) open(e.target.position.lineNumber);
    });
    m.addAction({
      id: "agos.review.comment",
      label: t("Comment on this line (review)"),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM],
      contextMenuGroupId: "navigation",
      run: (x) => open(x.getPosition()?.lineNumber ?? 1),
    });
  };

  // Mark the lines that already carry a comment.
  useEffect(() => {
    deco.current?.set(
      mine.filter((c) => c.line >= 1).map((c) => ({ range: { startLineNumber: c.line, startColumn: 1, endLineNumber: c.line, endColumn: 1 }, options: { isWholeLine: true, className: "rv-line", glyphMarginClassName: "rv-has" } })),
    );
  }, [mine.map((c) => c.line).join(",")]);

  return (
    <div className="rv-diff">
      <div className="rv-diff-bar">
        <span className="faint">{t("Click the margin or press Ctrl+Alt+M to comment a line")}</span>
        <button className={`btn sm ghost${tray ? " on" : ""}`} aria-expanded={tray} onClick={() => setTray((v) => !v)}>
          <ClipboardList size={14} /> {t("Review")} {comments.length > 0 && <span className="pill accent">{comments.length}</span>}
        </button>
      </div>
      <div className="rv-diff-main">
        <DiffEditor
          key={path + staged}
          original={original}
          modified={modified}
          language={languageOf(path)}
          theme="agent-os-nexo"
          onMount={onMount}
          options={{ readOnly: true, fontFamily: '"JetBrains Mono", monospace', fontSize: 13, minimap: { enabled: false }, renderSideBySide: true, scrollBeyondLastLine: false }}
        />
      </div>
      {draft && (
        <div className="rv-drawer">
          <CommentBox
            anchor={`${path}:${draft.line}`}
            onCancel={() => (setDraft(null), ed.current?.focus())}
            onSave={(text) => (reviewActions.add(tab.id, { path, line: draft.line, snippet: draft.snippet, text }), setDraft(null), setTray(true))}
          />
        </div>
      )}
      {tray && !draft && <div className="rv-drawer"><ReviewTray tabId={tab.id} refreshKey={modified} /></div>}
    </div>
  );
}
