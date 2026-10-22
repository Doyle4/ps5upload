import { useEffect, useState } from "react";
import { Button, Toggle } from "../../components";
import {
  minionSet,
  type MinionChange,
  type MinionTileState,
} from "../../api/consoleFiles";
import { useConnectionStore } from "../../state/connection";
import { useTr } from "../../state/lang";

type Tr = ReturnType<typeof useTr>;

export function MinionSettings() {
  const host = useConnectionStore((s) => s.host);
  const up = useConnectionStore((s) => s.payloadStatus === "up");
  return <MinionTileControl key={`${host}:${up}`} host={host} up={up} />;
}

/** The line under the controls: what the helper last did, in words. */
export function minionStatus(
  state: Extract<MinionTileState, { supported: true }>,
  tr: Tr,
): string {
  if (state.tile_busy)
    return tr("cw_files_perm_applying", undefined, "Updating the home screen…");
  if (state.enabled === false) {
    if (state.tile_failed)
      return tr(
        "minion_off_failed",
        undefined,
        "Minion is off, but its home-screen tile could not be removed. Turn Minion on and off again to retry.",
      );
    if (state.tile_result === "hidden")
      return tr(
        "minion_off_hidden",
        undefined,
        "Minion is off. The PS5 kept its record of the tile, so its icon is hidden instead.",
      );
    return tr(
      "minion_off_removed",
      undefined,
      "Minion is off: its home-screen tile is removed and the page on the console is stopped.",
    );
  }
  if (state.tile_failed)
    return tr(
      state.tile ? "cw_settings_err_tile_add" : "cw_settings_err_tile_remove",
      undefined,
      "The home screen update failed. Try again.",
    );
  if (state.tile)
    return tr(
      "minion_tile_on_state",
      undefined,
      "The home-screen tile is shown.",
    );
  if (state.tile_result === "hidden")
    return tr(
      "cw_settings_tile_hidden",
      undefined,
      "The PS5 kept its record of PS5Upload Minion, so its home-screen icon is hidden instead.",
    );
  return tr(
    "minion_tile_off_state",
    undefined,
    "The home-screen tile is hidden.",
  );
}

export interface MinionViewProps {
  up: boolean;
  state: MinionTileState | null;
  busy: boolean;
  onApply: (change: MinionChange) => void;
}

/** Settings → Minion without state (tests render it directly). */
export function MinionView({ up, state, busy, onApply }: MinionViewProps) {
  const tr = useTr();
  const ready = state?.supported ? state : null;
  // An older helper has no on/off switch: only the tile buttons, as before.
  const canSwitch = typeof ready?.enabled === "boolean";
  const on = ready?.enabled !== false;
  return (
    <>
      {!up && (
        <p>
          {tr(
            "minion_tile_connect",
            undefined,
            "Connect to the helper to change Minion visibility.",
          )}
        </p>
      )}
      {state?.supported === false && (
        <p>
          {tr(
            "minion_tile_update",
            undefined,
            "Update the helper to use this control.",
          )}
        </p>
      )}
      {ready && (
        <>
          {canSwitch ? (
            <Toggle
              checked={on}
              disabled={busy || ready.tile_busy}
              onChange={(enabled) => onApply({ enabled })}
              label={`${tr("cw_settings_app_name", undefined, "PS5Upload Minion")}: ${
                on
                  ? tr("cw_settings_on", undefined, "On")
                  : tr("cw_settings_off", undefined, "Off")
              }`}
              hint={tr(
                "minion_enabled_note",
                undefined,
                "Off removes the home-screen tile and stops the page on the console. The PC app keeps working, and you can turn Minion back on here at any time.",
              )}
            />
          ) : (
            <p className="text-[var(--color-muted)]">
              {tr(
                "minion_enabled_update",
                undefined,
                "Update the helper to turn PS5Upload Minion off completely.",
              )}
            </p>
          )}
          {on && (
            <p>
              {tr(
                "cw_settings_tile",
                undefined,
                "Show or hide Minion on the PS5 home screen using the paired helper connection.",
              )}
            </p>
          )}
          <p role="status">{minionStatus(ready, tr)}</p>
          {on && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || ready.tile_busy}
                onClick={() => onApply({ tile: true })}
              >
                {tr("minion_tile_show", undefined, "Show / restore Minion")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || ready.tile_busy}
                onClick={() => onApply({ tile: false })}
              >
                {tr("minion_tile_hide", undefined, "Hide Minion")}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function MinionTileControl({ host, up }: { host: string; up: boolean }) {
  const tr = useTr();
  const [state, setState] = useState<MinionTileState | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!host || !up || busy) return;
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const s = await minionSet(host);
        if (gone) return;
        setState(s);
        if (s.supported && s.tile_busy)
          timer = setTimeout(() => void poll(), 1500);
      } catch (e) {
        if (!gone) setError(String(e));
      }
    };
    void poll();
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [host, up, busy, attempt]);
  const apply = async (change: MinionChange) => {
    setBusy(true);
    setError(null);
    try {
      setState(await minionSet(host, change));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 text-sm">
      <MinionView
        up={up}
        state={state}
        busy={busy}
        onApply={(c) => void apply(c)}
      />
      {error && (
        <div>
          <p role="alert" className="text-[var(--color-bad)]">
            {error}
          </p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            {tr("retry", undefined, "Retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
