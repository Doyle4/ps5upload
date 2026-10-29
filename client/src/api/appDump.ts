import { getEngineUrl } from "../state/engine";
import { mgmtAddr } from "../lib/addr";
import { fsListDir, fsReadPreview } from "./ps5";

/** What to dump and how (POST /api/ps5/dump). */
export interface AppDumpRequest {
  titleId: string;
  /** The folder the dump goes in (a `<ID>-app` folder is made inside it). */
  dest: string;
  /** Decrypt the game's executables (riskier: see the Dumps screen). */
  decrypt: boolean;
  /** Fake-signed copies of the decrypted executables, for backporting. */
  fself: boolean;
  dlc: boolean;
}

export interface AppDumpResult {
  path: string;
  files: number;
  bytes: number;
  decrypted: number;
  decrypt_failed: number;
  /** Why decryption was skipped ("" when it ran or was not asked for). */
  decrypt_skipped: string;
  dlc: string[];
  fw: string;
}

/** Dump an installed game to a drive on the console. The engine starts the game first when it
 *  is not running (its files exist only then). Follow it with `fsOpStatus(addr, opId)`, stop it
 *  with `fsOpCancel`. Throws "cancelled" when stopped, else the helper's cause. */
export async function appDump(transferAddr: string, req: AppDumpRequest, opId: number): Promise<AppDumpResult> {
  const res = await fetch(`${getEngineUrl()}/api/ps5/dump`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      addr: mgmtAddr(transferAddr),
      title_id: req.titleId,
      dest: req.dest,
      decrypt: req.decrypt,
      fself: req.fself,
      dlc: req.dlc,
      op_id: opId,
    }),
  });
  const out = (await res.json().catch(() => ({}))) as Partial<AppDumpResult> & { error?: string };
  if (!res.ok) throw new Error(typeof out.error === "string" ? out.error : `HTTP ${res.status}`);
  return {
    path: out.path ?? "",
    files: out.files ?? 0,
    bytes: out.bytes ?? 0,
    decrypted: out.decrypted ?? 0,
    decrypt_failed: out.decrypt_failed ?? 0,
    decrypt_skipped: out.decrypt_skipped ?? "",
    dlc: out.dlc ?? [],
    fw: out.fw ?? "",
  };
}

/** A finished dump, from its dump-info.json. */
export interface DumpRecord extends Partial<AppDumpResult> {
  folder: string;
  title_id?: string;
  /** Seconds since the epoch. */
  time?: number;
  incomplete?: boolean;
}

/** The dumps in `root` (each `<ID>-app` folder, with its dump-info.json when it has one). */
export async function listDumps(transferAddr: string, root: string): Promise<DumpRecord[]> {
  let entries;
  try {
    entries = await fsListDir(transferAddr, root);
  } catch {
    return [];
  }
  const dirs = entries.filter((e) => e.kind === "dir" && /^[A-Z]{4}\d{5}/.test(e.name));
  return Promise.all(
    dirs.map(async (d): Promise<DumpRecord> => {
      const folder = `${root}/${d.name}`;
      try {
        const r = await fsReadPreview(transferAddr, `${folder}/dump-info.json`, 16 * 1024);
        const info = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))));
        return { ...info, folder };
      } catch {
        // No record: stopped before it finished, or made by another tool.
        return { folder, title_id: d.name.slice(0, 9), incomplete: true, time: d.mtime };
      }
    }),
  );
}
