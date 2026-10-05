// The workspace's center: the Monaco editor (optionally split, or with a Markdown preview beside it), a git diff,
// an image preview, or the empty state. Pure view — the workspace owns what's open.
import { X } from "lucide-react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { renderMarkdown } from "@os/lib/markdown";
import { languageOf } from "./monaco";
import type { Tab } from "./api";
import { DiffReview } from "../submodules/scm/web/DiffReview";
import { t } from "@os/i18n";

export type OpenFile = { path: string; content: string; saved: string; isNew: boolean };
export type DiffView = { path: string; staged: boolean; original: string; modified: string };

export function EditorArea({ tab, activeFile, open, diff, image, split, setSplit, mdPreview, options, onMount, onChange, emptyText }: {
  tab: Tab;
  activeFile: OpenFile | null;
  open: OpenFile[];
  diff: DiffView | null;
  image: string | null;
  split: string | null;
  setSplit: (p: string | null) => void;
  mdPreview: boolean;
  options: Record<string, unknown>;
  onMount: OnMount;
  onChange: (path: string, value: string) => void;
  emptyText: string;
}) {
  if (diff)
    return (
      <DiffReview tab={tab} path={diff.path} staged={diff.staged} original={diff.original} modified={diff.modified} />
    );
  if (image)
    return (
      <div className="img-wrap">
        <img src={`/api/tabs/${tab.id}/image?path=${encodeURIComponent(image)}`} alt={image} />
      </div>
    );
  if (!activeFile) return <div className="empty" style={{ marginTop: 80 }}>{emptyText}</div>;

  const splitFile = split ? open.find((o) => o.path === split) : undefined;
  return (
    <div className="split-row">
      <div className="split-pane">
        <Editor
          path={`file:///${activeFile.path}`}
          defaultValue={activeFile.content}
          language={languageOf(activeFile.path)}
          theme="agent-os"
          onMount={onMount}
          keepCurrentModel // the split pane may show the same file: models are disposed on close, not on unmount
          onChange={(v) => onChange(activeFile.path, v ?? "")}
          options={options}
        />
      </div>
      {mdPreview && activeFile.path.endsWith(".md") ? (
        <div className="split-pane md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(activeFile.content, { allowLocalImages: true }) }} />
      ) : splitFile ? (
        <div className="split-pane">
          <div className="split-head">
            <select className="field" value={splitFile.path} onChange={(e) => setSplit(e.target.value)}>
              {open.map((o) => <option key={o.path} value={o.path}>{o.path}</option>)}
            </select>
            <button className="btn sm ghost" title={t("Close the split")} aria-label={t("Close the split")} onClick={() => setSplit(null)}><X size={14} /></button>
          </div>
          <Editor
            key={splitFile.path}
            path={`file:///${splitFile.path}`}
            defaultValue={splitFile.content}
            language={languageOf(splitFile.path)}
            theme="agent-os"
            keepCurrentModel
            onChange={(v) => onChange(splitFile.path, v ?? "")}
            options={{ ...options, glyphMargin: false }}
          />
        </div>
      ) : null}
    </div>
  );
}
