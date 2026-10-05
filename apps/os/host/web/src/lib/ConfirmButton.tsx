// A button that asks once more, without window.confirm (rule R7): the first click arms it for 4 s and shows what
// will happen; the second one does it. ConfirmDelete is this with the trash icon and delete wording.
import { useEffect, useState, type ReactNode } from "react";
import { t } from "../i18n";

export function ConfirmButton({ onConfirm, confirmText, title, children, className = "btn sm ghost", disabled }: {
  onConfirm: () => void;
  /** Shown on the armed button: what the second click will do ("Discard the changes to a.ts?"). */
  confirmText: string;
  /** Tooltip and accessible name of the button at rest. */
  title: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <>
      {armed ? (
        <button className="btn sm danger armed" title={t("Click again to confirm.")} aria-label={confirmText} onClick={(e) => (e.stopPropagation(), setArmed(false), onConfirm())}>
          <span className="dk-armed-name">{confirmText}</span>
        </button>
      ) : (
        <button className={className} title={title} aria-label={title} disabled={disabled} onClick={(e) => (e.stopPropagation(), setArmed(true))}>
          {children}
        </button>
      )}
      <span className="sr-only" aria-live="polite">{armed ? t("Click again to confirm. It cancels itself in 4 seconds.") : ""}</span>
    </>
  );
}
