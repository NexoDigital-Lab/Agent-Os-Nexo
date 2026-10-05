// Two-step delete without window.confirm: the first click arms the button for 4s, the second one fires.
import { useEffect, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { t } from "../i18n";

export function ConfirmDelete({ onConfirm, title, name: rawName, note, disabled, children }: {
  onConfirm: () => void;
  title: string;
  name?: string; // what gets deleted: named in the armed state and in the aria-label
  note?: string; // extra consequence, shown as tooltip (e.g. dev containers also drop their shims)
  disabled?: boolean;
  children?: ReactNode;
}) {
  const name = rawName ?? "";
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <>
      {armed ? (
        <button className="btn sm danger armed" title={`${note ?? t("It can't be undone")}. ${t("Click again to confirm.")}`} aria-label={name ? t("Confirm: delete {name}", { name }) : t("Confirm the deletion")} onClick={() => (setArmed(false), onConfirm())}>
          <span className="dk-armed-name">{name ? t("Delete {name}?", { name }) : t("Delete?")}</span>
        </button>
      ) : (
        <button className="btn sm ghost danger" title={note ? `${title}. ${note}` : title} aria-label={name ? `${title}: ${name}` : title} disabled={disabled} onClick={() => setArmed(true)}>
          <Trash2 size={14} />
          {children}
        </button>
      )}
      <span className="sr-only" aria-live="polite">{armed ? t("Confirm the deletion. It cancels itself in 4 seconds.") : ""}</span>
    </>
  );
}
