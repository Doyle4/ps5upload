// Collection actions shared by the cards, the table, the batch bar and the game page: hand
// copies to Convert, and send games to one or more consoles.

import type { NavigateFunction } from "react-router";

import type {
  CollectionGame,
  CollectionLocation,
  GameConsoleState,
} from "../api/collection";
import { installOffers } from "../screens/GameHub/collectionInstall";
import { loadConsoleStates, useCollectionStore } from "../state/collection";
import { useConvertPrefs } from "../state/convertPrefs";
import { useUploadQueueStore } from "../state/uploadQueue";
import { useUploadStore } from "../state/upload";
import { sendStep } from "./collectionInsights";
import { DEFAULT_SEND_SUBPATH, collectionSendItem } from "./collectionSend";

/** Opens Convert with these copies: one is checked there, several go into its queue with the
 *  settings Convert has. `compress`: make a compressed game image (.ffpfsc) of them, the
 *  "take less room" build. */
export function openInConvert(
  navigate: NavigateFunction,
  copies: CollectionLocation[],
  opts: { compress?: boolean } = {},
): void {
  if (copies.length === 0) return;
  if (opts.compress) {
    const p = useConvertPrefs.getState();
    p.setMake("image");
    p.setImageChoice(p.imageFormat, true);
  }
  if (copies.length === 1) {
    navigate("/convert", { state: { source: copies[0].absolute_path } });
    return;
  }
  navigate("/convert", {
    state: {
      sources: copies.map((c) => ({
        path: c.absolute_path,
        isDir: c.type === "folder",
      })),
    },
  });
}

export interface SendResult {
  host: string;
  /** Packages put in the install queue. */
  installs: number;
  /** Folders, images and archives put in the Upload queue. */
  uploads: number;
  /** Games the console already has, up to date. */
  upToDate: number;
  /** Games with nothing that can be sent (an incomplete or unreadable copy only). */
  nothing: number;
  /** The console's state could not be read: games it may have were still queued, and the
   *  install queue refuses one that would erase an installed game. */
  unread: boolean;
}

/** Sends `games` to the console at `host`: newer updates and missing DLC for what it has; the
 *  base package (and its add-ons), or the best folder, image or archive, for what it lacks. */
export async function sendGamesTo(
  host: string,
  games: CollectionGame[],
): Promise<SendResult> {
  await loadConsoleStates(host);
  const entry = useCollectionStore.getState().consoleByHost[host];
  const unread = !entry || !!entry.error;
  const states: Record<string, GameConsoleState> = unread ? {} : entry.states;
  const out: SendResult = {
    host,
    installs: 0,
    uploads: 0,
    upToDate: 0,
    nothing: 0,
    unread,
  };
  const offers: Parameters<typeof installOffers>[1] = [];
  const uploadIds: string[] = [];
  const q = useUploadQueueStore.getState();
  const u = useUploadStore.getState();
  for (const g of games) {
    const step = sendStep(g, unread ? undefined : states[g.game_id]);
    if (step.kind === "install") {
      for (const offer of step.offers) offers.push({ game: g, offer });
    } else if (step.kind === "upload") {
      uploadIds.push(
        q.add(
          collectionSendItem(g, step.copy, {
            host,
            volume: u.destinationVolume ?? "/data",
            subpath: DEFAULT_SEND_SUBPATH,
            register: true,
          }),
        ),
      );
    } else if (step.why === "up-to-date") {
      out.upToDate += 1;
    } else {
      out.nothing += 1;
    }
  }
  out.installs = installOffers(host, offers);
  out.uploads = uploadIds.length;
  if (uploadIds.length > 0) void q.startHost(host, { onlyIds: uploadIds });
  return out;
}
