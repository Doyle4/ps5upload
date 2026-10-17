import { Copy, Eye, FolderInput, FolderPlus, Info, PencilLine, Trash2, type LucideIcon } from "lucide-react";
import { t } from "../strings";
import { Modal } from "../ui/Modal";

export type SheetAction = "view" | "copy" | "move" | "rename" | "mkdir" | "info" | "delete";

const ITEMS: Record<SheetAction, { icon: LucideIcon; key: string }> = {
  view: { icon: Eye, key: "cw_files_view" },
  copy: { icon: Copy, key: "cw_files_copy_to" },
  move: { icon: FolderInput, key: "cw_files_move_to" },
  rename: { icon: PencilLine, key: "cw_files_rename" },
  mkdir: { icon: FolderPlus, key: "cw_files_new_folder" },
  info: { icon: Info, key: "cw_files_info" },
  delete: { icon: Trash2, key: "cw_files_delete" },
};

/** The ones a running copy/move/delete request holds back (one batch at a time). */
const HELD: ReadonlySet<SheetAction> = new Set(["copy", "move", "delete"]);

/**
 * △ / "⋯": what can be done with one item or the selection, as a list of
 * buttons (D-pad + ✕). ○ or △ closes it.
 */
export function ActionsSheet({
  title,
  actions,
  busy,
  note,
  onChoose,
  onClose,
}: {
  title: string;
  actions: SheetAction[];
  /** A copy/move/delete request is running: those are off until it answers. */
  busy: boolean;
  /** The running request's progress line. */
  note?: string | null;
  onChoose: (a: SheetAction) => void;
  onClose: () => void;
}) {
  return (
    <Modal label={title} className="cw-sheet" onBack={onClose}>
      <h2 className="cw-sheet-title">{title}</h2>
      {note ? (
        <p className="cw-dim" role="status">
          {note}
        </p>
      ) : null}
      <div className="cw-sheet-items">
        {actions.map((a, i) => {
          const { icon: Icon, key } = ITEMS[a];
          return (
            <button
              key={a}
              type="button"
              className={`cw-focusable cw-sheet-item${a === "delete" ? " is-danger" : ""}`}
              data-sheet={a}
              data-nav-default={i === 0 ? "" : undefined}
              disabled={busy && HELD.has(a)}
              onClick={() => onChoose(a)}
            >
              <Icon aria-hidden />
              <span>{t(key)}</span>
            </button>
          );
        })}
      </div>
      <div className="cw-dialog-buttons">
        <button type="button" className="cw-focusable cw-button" onClick={onClose}>
          <span>{t("cw_files_close")}</span>
        </button>
      </div>
    </Modal>
  );
}
