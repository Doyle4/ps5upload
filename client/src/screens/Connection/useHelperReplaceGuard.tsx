import { useCallback } from "react";

import { useConfirm } from "../../components/ConfirmDialog";
import { meshAnnounce } from "../../api/mesh";
import { getAppVersion } from "../../lib/appVersion";
import { busyText, replaceCheck } from "../../lib/helperGuard";
import { useConnectionStore } from "../../state/connection";
import { useTr } from "../../state/lang";
import { meshFor, useMeshStore } from "../../state/mesh";

/**
 * Asks before this app's helper replaces the one running on `host` (8.0.0): when other devices
 * are busy there (their work stops until the helper is back), and when the running helper is
 * newer than this app's (a downgrade, for every device). Then tells the other devices the helper
 * is about to restart. True: go ahead and send.
 */
export function useHelperReplaceGuard(): { guard: (host: string) => Promise<boolean>; dialog: React.ReactNode } {
  const tr = useTr();
  const { confirm, dialog } = useConfirm();
  const guard = useCallback(
    async (host: string) => {
      const conn = useConnectionStore.getState();
      // Nothing is running there: nobody to warn.
      if (conn.payloadStatus !== "up") return true;
      const state = meshFor(useMeshStore.getState(), host).state;
      const app = await getAppVersion().catch(() => null);
      const check = replaceCheck(state, conn.payloadVersion, app);
      if (check.downgrade) {
        const { running, ours } = check.downgrade;
        const ok = await confirm({
          title: tr(
            "mesh_downgrade_title",
            { running, ours },
            `Replace helper v${running} with this app's older v${ours}?`,
          ),
          message: tr(
            "mesh_downgrade_body",
            undefined,
            "Another device sent a newer helper. Replacing it takes its newer features and fixes away from every device that uses this console. Updating this app is the better fix.",
          ),
          confirmLabel: tr("mesh_downgrade_confirm", undefined, "Replace with the older helper"),
          destructive: true,
        });
        if (!ok) return false;
      }
      if (check.busy.length) {
        const ok = await confirm({
          title: tr("mesh_busy_title", undefined, "Other devices are using this console"),
          message: tr(
            "mesh_busy_body",
            { work: busyText(check.busy) },
            `${busyText(check.busy)}. Sending the helper restarts it: their work stops, and uploads pick up where they left off once it is back.`,
          ),
          confirmLabel: tr("mesh_busy_confirm", undefined, "Send anyway"),
          destructive: true,
        });
        if (!ok) return false;
      }
      if (state) {
        // Best effort: the others hear it on their next poll, before the helper goes.
        await meshAnnounce(host, "restart", app ? `sending helper v${app}` : "sending the helper").catch(() => false);
      }
      return true;
    },
    [confirm, tr],
  );
  return { guard, dialog };
}
