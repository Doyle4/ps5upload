import { useEffect, useState } from "react";
import { FileArchive } from "lucide-react";

import { Button, Input, Modal, SegmentedControl } from "../../components";
import { archiveFolderName, freeFolderName, validFolderName } from "../../lib/archiveName";
import { useTr } from "../../state/lang";

/** What a folder that is already there gets: a new folder beside it, or the files merged in. */
export type ExtractMode = "new" | "merge" | "replace";

export interface ExtractChoice {
  /** The folder's name, next to the archive. */
  folder: string;
  merge: boolean;
  replace: boolean;
  password: string;
}

/** The choice the dialog starts a job with: Keep both picks a free name, Merge keeps the one taken. */
export function extractChoice(folder: string, mode: ExtractMode, exists: (n: string) => boolean, password: string): ExtractChoice {
  const taken = exists(folder);
  if (!taken || mode === "new") return { folder: taken ? freeFolderName(folder, exists) : folder, merge: false, replace: false, password };
  return { folder, merge: true, replace: mode === "replace", password };
}

/**
 * Extract an archive on the console: the folder it goes into (next to the
 * archive, named after it), what to do when that folder is already there
 * (Keep both, Merge skipping files already there, Merge replacing them), and a
 * password for an archive that has one. `passwordAsk` reopens it to ask only
 * for the password after the console said it needs one (or that it was wrong).
 */
export function ExtractDialog({
  open,
  name,
  dir,
  exists,
  passwordAsk = null,
  initial = null,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** The archive's file name. */
  name: string;
  /** The folder it is in. */
  dir: string;
  /** A name already in `dir` (the listing shown). */
  exists: (name: string) => boolean;
  passwordAsk?: "required" | "wrong" | null;
  /** The choice of the run that needs a password: kept as it was. */
  initial?: ExtractChoice | null;
  onCancel: () => void;
  onConfirm: (choice: ExtractChoice) => void;
}) {
  const tr = useTr();
  const [folder, setFolder] = useState(() => archiveFolderName(name));
  const [mode, setMode] = useState<ExtractMode>("new");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) return;
    setFolder(initial?.folder ?? archiveFolderName(name));
    setMode(initial ? (initial.replace ? "replace" : initial.merge ? "merge" : "new") : "new");
    setPassword("");
  }, [open, name, initial]);

  const asking = passwordAsk != null;
  const okName = validFolderName(folder.trim());
  const taken = okName && !asking && exists(folder.trim());
  const blocked = !okName || (asking && password === "");
  const target = `${dir.replace(/\/+$/, "")}/${folder.trim()}`;

  const confirm = () => {
    if (blocked) return;
    if (asking && initial) {
      onConfirm({ ...initial, password });
      return;
    }
    onConfirm(extractChoice(folder.trim(), mode, exists, password));
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      titleIcon={<FileArchive size={18} />}
      title={tr("fs_extract_title", { name }, `Extract "${name}"`)}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {tr("cancel", undefined, "Cancel")}
          </Button>
          <Button variant="primary" disabled={blocked} onClick={confirm} data-testid="fs-extract-go">
            {tr("fs_extract_confirm_label", undefined, "Extract")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        {asking ? (
          <p role="alert" className="text-[var(--color-warn,inherit)]">
            {passwordAsk === "wrong"
              ? tr("fs_extract_password_wrong", undefined, "That password is wrong. Enter it again.")
              : tr("fs_extract_password_needed", undefined, "This archive is password-protected. Enter its password.")}
          </p>
        ) : (
          <>
            <p className="text-[var(--color-text-muted)]">
              {tr(
                "fs_extract_body",
                undefined,
                "The console extracts it into a folder next to it and keeps the archive. Nothing goes through this computer.",
              )}
            </p>
            <Input
              label={tr("fs_extract_folder", undefined, "Folder")}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              error={okName ? undefined : tr("fs_extract_folder_bad", undefined, "Use one folder name, without “/”.")}
              hint={target}
              autoComplete="off"
              spellCheck={false}
              data-testid="fs-extract-folder"
            />
            {taken && (
              <div className="flex flex-col gap-2" data-testid="fs-extract-exists">
                <p>{tr("fs_extract_exists", { name: folder.trim() }, `A folder named "${folder.trim()}" is already here.`)}</p>
                <SegmentedControl
                  ariaLabel={tr("fs_extract_exists_label", undefined, "When the folder is already there")}
                  value={mode}
                  onChange={(v) => setMode(v as ExtractMode)}
                  segments={[
                    { value: "new", label: tr("fs_extract_mode_new", undefined, "Keep both") },
                    { value: "merge", label: tr("fs_extract_mode_merge", undefined, "Merge, skip existing files") },
                    { value: "replace", label: tr("fs_extract_mode_replace", undefined, "Merge, replace files") },
                  ]}
                />
                {mode === "new" && (
                  <p className="text-[var(--color-text-muted)]">
                    {tr("fs_extract_new_into", { name: freeFolderName(folder.trim(), exists) }, `Extracts into "${freeFolderName(folder.trim(), exists)}".`)}
                  </p>
                )}
                {mode === "replace" && (
                  <p role="alert" className="text-[var(--color-danger,inherit)]">
                    {tr(
                      "fs_extract_replace_warn",
                      undefined,
                      "Files in that folder with the same name as one in the archive are overwritten. This can't be undone.",
                    )}
                  </p>
                )}
              </div>
            )}
          </>
        )}
        <Input
          type="password"
          label={
            asking
              ? tr("fs_extract_password_label", undefined, "Password")
              : tr("fs_extract_password", undefined, "Password (only if it has one)")
          }
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
          autoFocus={asking}
          data-testid="fs-extract-password"
        />
      </form>
    </Modal>
  );
}
