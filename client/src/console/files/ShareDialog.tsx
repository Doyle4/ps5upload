import { useEffect, useRef, useState } from "react";
import { Search, Server } from "lucide-react";
import { errorText } from "../home/Home";
import { t } from "../strings";
import { Modal } from "../ui/Modal";
import { PhoneHandoff } from "../ui/PhoneHandoff";
import { discoverShares, saveShare, shareAddress, smbCallErrorText, type SmbShare } from "./smb";

/** The dialog's fields as typed. */
export interface ShareFields {
  server: string;
  share: string;
  user: string;
  password: string;
  domain: string;
  folder: string;
  name: string;
}

export function fieldsOf(s: SmbShare | null): ShareFields {
  if (!s) return { server: "", share: "", user: "", password: "", domain: "", folder: "", name: "" };
  return {
    server: s.port && s.port !== 445 ? `${s.host.includes(":") ? `[${s.host}]` : s.host}:${s.port}` : s.host,
    share: s.share,
    user: s.user,
    password: "",
    domain: s.domain,
    folder: s.start_path,
    name: s.name,
  };
}

/** Why the fields cannot be sent yet (checked before any call), or null. */
export function fieldsProblem(f: ShareFields): string | null {
  if (!f.server.trim()) return t("cw_files_smb_need_server");
  // "smb://nas/Share" in the server box names the share too.
  if (!f.share.trim() && !/^(smb:\/\/|\\\\|\/\/)[^/\\]+[/\\][^/\\]+/i.test(f.server.trim())) return t("cw_files_smb_need_share");
  return null;
}

/** The text a failed save / listing shows in the dialog. */
export function shareErrorText(e: unknown): string {
  return smbCallErrorText(e) ?? errorText(e) ?? t("cw_files_smb_err_generic");
}

/**
 * Add or edit a network share: server, share (or "Find shares" on the
 * server), user and password (empty user = guest), domain, a folder to open
 * at, and a name. Save signs in and opens the folder first; it is saved only
 * when that works. Editing leaves the password box empty: left empty, the saved
 * password stays. ○ / Cancel closes without saving.
 */
export function ShareDialog({
  share,
  onSaved,
  onCancel,
}: {
  /** The share to edit; null adds one. */
  share: SmbShare | null;
  onSaved: (s: SmbShare) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<ShareFields>(() => fieldsOf(share));
  const [busy, setBusy] = useState<"save" | "find" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ name: string; remark: string }[] | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const set = (k: keyof ShareFields) => (v: string) => {
    setF((o) => ({ ...o, [k]: v }));
    setError(null);
  };

  const find = () => {
    if (busy) return;
    if (!f.server.trim()) {
      setError(t("cw_files_smb_need_server"));
      return;
    }
    setBusy("find");
    setError(null);
    discoverShares({ server: f.server.trim(), user: f.user, password: f.password, domain: f.domain }).then(
      (d) => {
        if (!mounted.current) return;
        setBusy(null);
        setFound(d.shares);
        if (!d.shares.length) setError(t("cw_files_smb_none_found"));
        if (d.share && !f.share) setF((o) => ({ ...o, share: d.share, folder: o.folder || d.path }));
      },
      (e: unknown) => {
        if (!mounted.current) return;
        setBusy(null);
        setError(`${t("cw_files_smb_find_failed")} ${shareErrorText(e)}`);
      },
    );
  };

  const save = () => {
    if (busy) return;
    const why = fieldsProblem(f);
    if (why) {
      setError(why);
      return;
    }
    setBusy("save");
    setError(null);
    saveShare({
      ...(share ? { id: share.id } : {}),
      name: f.name.trim(),
      server: f.server.trim(),
      share: f.share.trim(),
      user: f.user.trim(),
      // Editing with the box left empty keeps the saved password.
      ...(share && share.has_password && !f.password ? {} : { password: f.password }),
      domain: f.domain.trim(),
      start_path: f.folder.trim(),
    }).then(
      (r) => {
        if (!mounted.current) return;
        setBusy(null);
        onSaved(r.share);
      },
      (e: unknown) => {
        if (!mounted.current) return;
        setBusy(null);
        setError(shareErrorText(e));
      },
    );
  };

  const title = share ? t("cw_files_smb_edit_title", { name: share.name }) : t("cw_files_smb_add_title");
  const field = (k: keyof ShareFields, label: string, opts: { type?: string; hint?: string; first?: boolean } = {}) => (
    <label className="cw-field">
      <span className="cw-dim">{label}</span>
      <input
        className="cw-focusable cw-input"
        type={opts.type ?? "text"}
        value={f[k]}
        data-field={k}
        data-nav-default={opts.first ? "" : undefined}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={opts.hint}
        onChange={(e) => set(k)(e.target.value)}
      />
    </label>
  );

  return (
    <Modal label={title} className="cw-share-dialog" onBack={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2 className="cw-sheet-title">
          <Server aria-hidden /> {title}
        </h2>
        <div className="cw-share-grid">
          {field("server", t("cw_files_smb_server"), { hint: t("cw_files_smb_server_hint"), first: true })}
          <div className="cw-share-row">
            {field("share", t("cw_files_smb_share"))}
            <button
              type="button"
              className="cw-focusable cw-button"
              data-action="smb-find"
              aria-busy={busy === "find" || undefined}
              onClick={find}
            >
              <Search aria-hidden />
              <span>{busy === "find" ? t("cw_home_loading") : t("cw_files_smb_find")}</span>
            </button>
          </div>
          {found && found.length ? (
            <ul className="cw-share-found" data-nav-list aria-label={t("cw_files_smb_found")}>
              {found.map((s) => (
                <li key={s.name}>
                  <button
                    type="button"
                    className={`cw-focusable cw-button${s.name === f.share ? " is-primary" : ""}`}
                    data-found={s.name}
                    onClick={() => set("share")(s.name)}
                  >
                    <span>{s.name}</span>
                    {s.remark ? <span className="cw-dim"> {s.remark}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {field("user", t("cw_files_smb_user"), { hint: t("cw_files_smb_user_hint") })}
          {field("password", t("cw_files_smb_password"), {
            type: "password",
            hint: share?.has_password ? t("cw_files_smb_password_kept") : undefined,
          })}
          {field("domain", t("cw_files_smb_domain"), { hint: t("cw_files_smb_optional") })}
          {field("folder", t("cw_files_smb_folder"), { hint: t("cw_files_smb_optional") })}
          {field("name", t("cw_files_smb_name"), {
            hint: f.server && f.share ? shareAddress({ host: f.server, port: 445, share: f.share }) : t("cw_files_smb_optional"),
          })}
        </div>
        {error ? (
          <p className="cw-field-error" role="alert">
            {error}
          </p>
        ) : null}
        <PhoneHandoff />
        <div className="cw-dialog-buttons">
          <button type="button" className="cw-focusable cw-button" onClick={onCancel}>
            <span>{t("cw_dialog_cancel")}</span>
          </button>
          <button type="submit" className="cw-focusable cw-button is-primary" data-action="smb-save" aria-busy={busy === "save" || undefined}>
            <span>{busy === "save" ? t("cw_files_smb_connecting") : t("cw_files_smb_save")}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
