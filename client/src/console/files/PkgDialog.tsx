import { useEffect, useState } from "react";
import { PackagePlus, Package } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { ApiError } from "../api";
import { t } from "../strings";
import { Modal } from "../ui/Modal";
import { filesErrorText } from "./Files";
import { kindText, pkgErrorText, pkgIconUrl, pkgInfo, type PkgInfo } from "./pkg";
import "./viewer/viewer.css";

type Load = { info: PkgInfo } | { error: string | null } | null;

/** Why Install is off for `info`, or null. */
export function installBlocker(info: PkgInfo, busy: boolean): string | null {
  if (info.image_mounted) return t("cw_pkg_err_image");
  if (info.installing) return t("cw_pkg_err_busy");
  if (busy) return t("cw_files_unpack_wait_batch");
  return null;
}

/** The facts the preview lists, in order (pure: tests call it). */
export function pkgRows(info: PkgInfo): [string, string][] {
  const rows: [string, string][] = [];
  if (info.title_id) rows.push([t("cw_pkg_title_id"), info.title_id]);
  if (info.content_id) rows.push([t("cw_pkg_content_id"), info.content_id]);
  if (info.version) rows.push([t("cw_pkg_version"), info.version]);
  const plat = info.platform === "ps4" ? "PS4" : info.platform === "ps5" ? "PS5" : "";
  rows.push([t("cw_pkg_type"), plat ? `${kindText(info.kind)} · ${plat}` : kindText(info.kind)]);
  rows.push([t("cw_files_info_size"), formatBytes(info.size)]);
  rows.push([t("cw_pkg_fw"), info.fw || t("cw_pkg_fw_unknown")]);
  return rows;
}

/** The preview itself (props only: tests render it). */
export function PkgDialogView({
  name,
  state,
  icon,
  busy,
  onInstall,
  onClose,
}: {
  name: string;
  state: Load;
  icon: string | null;
  busy: boolean;
  onInstall: (replace: boolean, info: PkgInfo) => void;
  onClose: () => void;
}) {
  const info = state && "info" in state ? state.info : null;
  const blocker = info ? installBlocker(info, busy) : null;
  const title = info?.title || name;
  return (
    <Modal label={title} className="cw-pkg" onBack={onClose}>
      <div className="cw-gb is-summary" data-pkg={info?.title_id ?? ""}>
        {icon ? <img className="cw-gb-icon cw-pkg-icon" src={icon} alt="" /> : <Package className="cw-gb-icon is-none" aria-hidden />}
        <div className="cw-gb-text">
          <strong className="cw-gb-title">{title}</strong>
          <span className="cw-dim cw-mono cw-gb-facts">{name}</span>
        </div>
      </div>
      {state == null ? <p className="cw-dim">{t("cw_home_loading")}</p> : null}
      {info ? (
        <dl className="cw-info">
          {pkgRows(info).map(([k, v]) => (
            <div key={k}>
              <dt className="cw-dim">{k}</dt>
              <dd className={k === t("cw_pkg_content_id") ? "cw-mono" : undefined}>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {info?.fake ? <p className="cw-dim">{t("cw_pkg_fake_note")}</p> : null}
      {info?.staged && !blocker ? <p className="cw-dim">{t("cw_pkg_staged_note")}</p> : null}
      {info?.installed && !blocker ? (
        <p className="cw-field-error" role="alert" data-pkg-installed="">
          {t("cw_pkg_installed_note")}
        </p>
      ) : null}
      {blocker ? (
        <p className="cw-field-error" role="alert" data-pkg-blocked="">
          {blocker}
        </p>
      ) : null}
      {state && "error" in state ? (
        <p className="cw-field-error" role="alert">
          {state.error ?? t("cw_files_err_read")}
        </p>
      ) : null}
      <div className="cw-dialog-buttons">
        <button type="button" className="cw-focusable cw-button" data-nav-default="" onClick={onClose}>
          <span>{t("cw_files_close")}</span>
        </button>
        {info ? (
          <button
            type="button"
            className={`cw-focusable cw-button${info.installed ? "" : " is-primary"}`}
            data-action="pkg-install"
            disabled={blocker != null}
            onClick={() => onInstall(info.installed, info)}
          >
            <PackagePlus aria-hidden />
            <span>{t(info.installed ? "cw_pkg_reinstall" : "cw_pkg_install")}</span>
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * ✕ on a .pkg: what the package is (read on the console: title, ids, version,
 * kind, PS4/PS5, size, required firmware, its icon) and Install. A full game
 * that is installed already offers Reinstall instead, with the warning that the
 * console removes the installed copy first.
 */
export function PkgDialog({
  name,
  path,
  busy,
  onInstall,
  onClose,
}: {
  name: string;
  path: string;
  /** Another batch runs: Install waits. */
  busy: boolean;
  onInstall: (replace: boolean, info: PkgInfo) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<Load>(null);
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let url: string | null = null;
    const stop = new AbortController();
    setState(null);
    setIcon(null);
    pkgInfo(path).then(
      (info) => {
        if (!live) return;
        setState({ info });
        if (!info.icon) return;
        pkgIconUrl(path, stop.signal).then(
          (u) => {
            if (!live) {
              URL.revokeObjectURL(u);
              return;
            }
            url = u;
            setIcon(u);
          },
          () => undefined,
        );
      },
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 401) return;
        setState({ error: pkgErrorText(e, filesErrorText) });
      },
    );
    return () => {
      live = false;
      stop.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return <PkgDialogView name={name} state={state} icon={icon} busy={busy} onInstall={onInstall} onClose={onClose} />;
}
