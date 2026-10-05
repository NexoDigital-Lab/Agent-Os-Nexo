// Inline form to write a review comment anchored to path:line. Enter saves, Shift+Enter is a newline, Esc cancels.
import { useEffect, useRef, useState } from "react";
import { t } from "@os/i18n";

export function CommentBox({ anchor, initial = "", onSave, onCancel }: { anchor: string; initial?: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const save = () => text.trim() && onSave(text.trim());
  return (
    <div className="rv-box" onClick={(e) => e.stopPropagation()}>
      <div className="rv-anchor mono">{anchor}</div>
      <textarea
        ref={ref}
        className="field"
        rows={2}
        value={text}
        placeholder={t("What needs fixing on this line")}
        aria-label={t("Comment for {where}", { where: anchor })}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          else if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), save());
        }}
      />
      <div className="rv-actions">
        <button className="btn sm ghost" onClick={onCancel}>{t("Cancel")}</button>
        <button className="btn sm primary" disabled={!text.trim()} onClick={save}>{t("Save comment")}</button>
      </div>
    </div>
  );
}
