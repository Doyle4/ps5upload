// How Settings › Backups lists the copies: grouped by the device that made them, newest
// first, with runs of look-alike copies folded into one row. A browser makes a backup per
// session and a day, so the raw list is mostly the same few settings over and over.

/** What a row needs to know about a copy. `sig` says when two copies are alike: same device,
 *  same kind of backup, same number of settings and the same size. */
export interface BackupItem<T> {
  device: string;
  at: number;
  sig: string;
  item: T;
}

/** One row: the newest copy of a run of look-alike, back-to-back copies. Look-alike is not
 *  identical (the values may differ), so every copy stays restorable: the row unfolds to list
 *  them (`copies`). */
export interface BackupRow<T> {
  newest: BackupItem<T>;
  /** Every copy the row stands for, newest first (`copies[0]` is `newest`). */
  copies: BackupItem<T>[];
  /** How many copies the row stands for (1 = just this one). */
  count: number;
  /** The oldest copy's time, when the row stands for more than one. */
  oldestAt: number;
}

export interface BackupDeviceGroup<T> {
  device: string;
  rows: BackupRow<T>[];
  /** Every copy in the group, folded or not. */
  total: number;
}

/** Groups by device (the device with the newest copy first), newest copy first inside each,
 *  and folds consecutive copies with the same `sig` into one row. */
export function groupBackups<T>(items: BackupItem<T>[]): BackupDeviceGroup<T>[] {
  const sorted = [...items].sort((a, b) => b.at - a.at);
  const groups = new Map<string, BackupDeviceGroup<T>>();
  for (const it of sorted) {
    let g = groups.get(it.device);
    if (!g) {
      g = { device: it.device, rows: [], total: 0 };
      groups.set(it.device, g);
    }
    g.total += 1;
    const last = g.rows[g.rows.length - 1];
    if (last && last.newest.sig === it.sig) {
      last.count += 1;
      last.oldestAt = it.at;
      last.copies.push(it);
    } else {
      g.rows.push({ newest: it, copies: [it], count: 1, oldestAt: it.at });
    }
  }
  return [...groups.values()];
}

/** Rows shown before "Show all". */
export const BACKUP_ROWS_SHOWN = 3;
