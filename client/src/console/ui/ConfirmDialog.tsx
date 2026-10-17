import { useEffect, useRef } from "react";
import { focusElement, onNavAction, type NavAction } from "../nav";
import { t } from "../strings";

/**
 * The dialog's controller handling: ○ is "no". Every other action is swallowed
 * while it is open (the page behind never sees them anyway: nav.ts scopes
 * handlers to the open modal).
 */
export function dialogNavHandler(onCancel: () => void): (action: NavAction) => boolean {
  return (action) => {
    if (action === "back") onCancel();
    return true;
  };
}

/**
 * "Are you sure?" for anything that cannot be undone: close a game, cancel a
 * task, rest mode, restart, delete. A nav modal: the D-pad stays inside it,
 * focus starts on the safe choice (listed first), ○ closes it, and focus goes
 * back where it was when it closes.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  /** Default: "Cancel". */
  cancelLabel?: string;
  /** The confirm button in the warning colour. */
  danger?: boolean;
  /** The action is running: a second ✕ does nothing. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const safe = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (safe.current) focusElement(safe.current);
    return () => {
      if (before && before !== document.body && before.isConnected) focusElement(before);
    };
  }, []);

  useEffect(() => onNavAction(dialogNavHandler(onCancel), () => root.current), [onCancel]);

  return (
    <div className="cw-scrim">
      <div
        ref={root}
        className="cw-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cw-dialog-title"
        aria-describedby={body ? "cw-dialog-body" : undefined}
        aria-busy={busy ? true : undefined}
        data-nav-modal
      >
        <h2 id="cw-dialog-title">{title}</h2>
        {body ? <p id="cw-dialog-body">{body}</p> : null}
        <div className="cw-dialog-buttons">
          <button ref={safe} type="button" className="cw-focusable cw-button" data-nav-default onClick={onCancel}>
            <span>{cancelLabel ?? t("cw_dialog_cancel")}</span>
          </button>
          <button
            type="button"
            className={`cw-focusable cw-button ${danger ? "is-danger" : "is-primary"}`}
            onClick={() => {
              if (!busy) onConfirm();
            }}
          >
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
