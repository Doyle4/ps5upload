import { fsCopy, fsDelete, fsOpCancel, fsOpStatus } from "../api/ps5";
import type { LibraryMoveDeps } from "../state/libraryMove";
import { deleteWithRetry } from "./deleteWithRetry";

/** What a Library move needs from the app (see state/libraryMove). Shared by the Games row and
 *  the space planner so both move the same way. */
export const libraryMoveDeps: LibraryMoveDeps = {
  copy: (addr, from, to, opId) => fsCopy(addr, from, to, opId),
  opStatus: fsOpStatus,
  opCancel: fsOpCancel,
  deleteSource: (addr, path) =>
    deleteWithRetry({
      deleter: () => fsDelete(addr, path),
      onAttemptFail: (attempt, e) =>
        console.warn(
          `[library] move delete attempt ${attempt}/3 for ${path} failed:`,
          e,
        ),
    }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  newOpId: () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
};
