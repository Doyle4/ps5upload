import { useEffect, useState } from "react";
import { formatBytes } from "../../lib/format";
import { call } from "../api";
import { getLanguage, t } from "../strings";
import { Modal } from "../ui/Modal";
import { LIST_PAGE } from "./useDir";

interface Stat {
  kind: string;
  size: number;
  mtime: number;
  mode: number;
}

type Info = { stat: Stat; items: string | null } | { error: true } | null;

function kindText(kind: string): string {
  if (kind === "dir") return t("cw_files_kind_dir");
  if (kind === "link") return t("cw_files_kind_link");
  return t("cw_files_kind_file");
}

/**
 * Info: type, size, modified time, permissions, and for a folder how many
 * entries it holds (the first page's count; "256+" when there are more —
 * a full count or total size would walk the whole tree).
 */
export function InfoDialog({ dir, name, path, onClose }: { dir: string; name: string; path: string; onClose: () => void }) {
  const [info, setInfo] = useState<Info>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const stat = await call<Stat>("/api/fs/stat", { path });
      let items: string | null = null;
      if (stat.kind === "dir") {
        const r = await call<{ entries?: unknown[]; more?: boolean }>("/api/fs/list", { path, offset: 0, limit: LIST_PAGE });
        const n = Array.isArray(r?.entries) ? r.entries.length : 0;
        items = r?.more ? `${n}+` : String(n);
      }
      if (live) setInfo({ stat, items });
    })().catch(() => {
      if (live) setInfo({ error: true });
    });
    return () => {
      live = false;
    };
  }, [path]);

  const rows: [string, string][] = [[t("cw_files_info_where"), dir]];
  if (info && "stat" in info) {
    const s = info.stat;
    rows.push([t("cw_files_info_type"), kindText(s.kind)]);
    if (s.kind === "dir") rows.push([t("cw_files_info_items"), info.items ?? "—"]);
    else rows.push([t("cw_files_info_size"), formatBytes(s.size)]);
    if (s.mtime > 0) rows.push([t("cw_files_info_modified"), new Date(s.mtime * 1000).toLocaleString(getLanguage())]);
    rows.push([t("cw_files_info_mode"), (s.mode & 0o7777).toString(8).padStart(4, "0")]);
  }

  return (
    <Modal label={name} onBack={onClose}>
      <h2 className="cw-file-name">{name}</h2>
      <dl className="cw-info">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="cw-dim">{k}</dt>
            <dd className={k === t("cw_files_info_where") ? "cw-mono" : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
      {info == null ? <p className="cw-dim">{t("cw_home_loading")}</p> : null}
      {info && "error" in info ? <p className="cw-field-error">{t("cw_files_err_read")}</p> : null}
      <div className="cw-dialog-buttons">
        <button type="button" className="cw-focusable cw-button" data-nav-default="" onClick={onClose}>
          <span>{t("cw_files_close")}</span>
        </button>
      </div>
    </Modal>
  );
}
