import { useState } from "react";
import { t } from "../strings";
import { Modal } from "../ui/Modal";
import { validName } from "./move";

/**
 * Rename / New folder: one text box (the PS5 shows its keyboard), OK and
 * Cancel. A name with "/" (or "." / "..") is refused here, before any call.
 */
export function TextPrompt({
  title,
  initial,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [bad, setBad] = useState(false);
  const submit = () => {
    if (!validName(value)) {
      setBad(true);
      return;
    }
    onSubmit(value);
  };
  return (
    <Modal label={title} onBack={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2>{title}</h2>
        <label className="cw-field">
          <span className="cw-dim">{t("cw_files_name")}</span>
          <input
            className="cw-focusable cw-input"
            type="text"
            value={value}
            data-nav-default=""
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => {
              setValue(e.target.value);
              setBad(false);
            }}
          />
        </label>
        {bad ? (
          <p className="cw-field-error" role="alert">
            {t("cw_files_bad_name")}
          </p>
        ) : null}
        <div className="cw-dialog-buttons">
          <button type="button" className="cw-focusable cw-button" onClick={onCancel}>
            <span>{t("cw_dialog_cancel")}</span>
          </button>
          <button type="submit" className="cw-focusable cw-button is-primary">
            <span>{t("cw_files_ok")}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
