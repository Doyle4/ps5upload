// Where an export (settings backup, logs, a bug report, a save backup, a folder as .zip...) goes.
//
// Desktop and Android: the system save dialog. `null` means the person cancelled; Android's
// dialog answers with a content:// URI, which the backend redirects into Downloads (see
// save_dest.rs).
//
// iPhone: the save dialog does not hand back a path this app can write, so there is no dialog:
// the file goes into the app's own Documents folder, the one the Files app shows under
// On My iPhone → PS5Upload, under the suggested name (with " (2)", " (3)"... when taken).
import { localFs } from "../api/localFs";
import { isIOS } from "./platform";

export interface SaveDestOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}

export async function pickSaveDest(opts: SaveDestOptions): Promise<string | null> {
  if (isIOS()) return documentsDest(opts.defaultPath ?? "ps5upload-export");
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save(opts);
}

/** A free name in the iPhone app's Documents folder. Exported for tests. */
export async function documentsDest(suggested: string): Promise<string> {
  const leaf = suggested.split(/[\\/]/).pop()?.trim() || "ps5upload-export";
  const [docs] = await localFs.storageRoots();
  const taken = new Set(
    (await localFs.listDir(docs).catch(() => [])).map((e) => e.name),
  );
  const dot = leaf.lastIndexOf(".");
  const stem = dot > 0 ? leaf.slice(0, dot) : leaf;
  const ext = dot > 0 ? leaf.slice(dot) : "";
  let name = leaf;
  for (let n = 2; taken.has(name); n++) name = `${stem} (${n})${ext}`;
  return `${docs.replace(/\/+$/, "")}/${name}`;
}
