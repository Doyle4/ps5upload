import { HardDrive, Usb } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { isDrive, volumeLabel, type Volume } from "../home/Home";
import { t } from "../strings";

const isUsb = (v: Volume) => /^\/mnt\/usb\d+$/.test(v.path) || v.mount_from.startsWith("/dev/da");

/** Files' first level: one row per drive (internal, extended/M.2, USB) with its free space. */
export function DriveList({
  volumes,
  error,
  onOpen,
}: {
  volumes: Volume[] | null;
  error: boolean;
  onOpen: (path: string) => void;
}) {
  const drives = (volumes ?? []).filter(isDrive);
  if (!drives.length) {
    return <p className="cw-dim">{error ? t("cw_home_err_load_storage") : t("cw_home_loading")}</p>;
  }
  return (
    <ul className="cw-files" data-nav-list aria-label={t("cw_files_drives")}>
      {drives.map((v) => {
        const Icon = isUsb(v) ? Usb : HardDrive;
        const used = v.total_bytes > 0 ? Math.max(0, Math.min(100, 100 - (v.free_bytes / v.total_bytes) * 100)) : 0;
        return (
          <li key={v.path} className="cw-file is-plain" data-nav-item>
            <button
              type="button"
              className="cw-focusable cw-file-main"
              data-drive={v.path}
              onClick={() => onOpen(v.path)}
            >
              <Icon className="cw-file-icon" aria-hidden />
              <span className="cw-file-text">
                <span className="cw-file-name">
                  {volumeLabel(v)}
                  {!v.writable ? <span className="cw-tag">{t("cw_home_vol_readonly")}</span> : null}
                </span>
                <span className="cw-dim cw-mono">{v.path}</span>
              </span>
              <span className="cw-file-meta">
                <span className="cw-bar" aria-hidden>
                  <span className={`cw-bar-fill${used >= 90 ? " is-warn" : ""}`} style={{ width: `${used}%` }} />
                </span>
                {t("cw_home_free_of", { free: formatBytes(v.free_bytes), total: formatBytes(v.total_bytes) })}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
