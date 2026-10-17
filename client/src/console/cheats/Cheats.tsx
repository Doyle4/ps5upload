import { useEffect, useRef, useState } from "react";
import { Gamepad2, RefreshCw } from "lucide-react";
import { useAppCover } from "../home/Home";
import { onNavAction } from "../nav";
import { t } from "../strings";
import { pollWhileVisible } from "../ui/visiblePoll";
import {
  cheatsPhase,
  createCheatsController,
  EMPTY_STATE,
  type CheatMod,
  type CheatsController,
  type CheatsState,
} from "./model";

/** The running game is looked for this often while Cheats is open and the page is visible. */
export const CHEATS_POLL_MS = 5_000;

export interface CheatsViewProps {
  state: CheatsState;
  /** The running game's cover (an object URL), or null (the generic icon shows). */
  cover?: string | null;
  onCoverError?: () => void;
  onToggle: (mod: CheatMod) => void;
  onRefresh: () => void;
}

/**
 * One cheat: a switch (✕ clicks it, □ switches the focused one), or Apply for a one-shot cheat.
 * While any switch runs the rows are aria-disabled, not disabled: a disabled button drops the
 * focus ring to nowhere, and the controller (model.toggle) ignores presses meanwhile anyway.
 */
function CheatRow({ mod, busy, disabled, onToggle }: { mod: CheatMod; busy: boolean; disabled: boolean; onToggle: (m: CheatMod) => void }) {
  let tag: string;
  if (busy) tag = t("cw_cheats_switching");
  else if (mod.button) tag = t("cw_cheats_apply");
  else tag = t(mod.on ? "cw_cheats_on" : "cw_cheats_off");
  return (
    <li className="cw-cheat-item">
      <button
        type="button"
        role={mod.button ? undefined : "switch"}
        aria-checked={mod.button ? undefined : mod.on}
        aria-busy={busy || undefined}
        aria-disabled={disabled || undefined}
        className={`cw-focusable cw-button cw-cheat${mod.on && !mod.button ? " is-on" : ""}`}
        data-cheat-index={mod.index}
        onClick={() => onToggle(mod)}
      >
        <span className="cw-cheat-text">
          <span className="cw-cheat-name">{mod.name}</span>
          {mod.desc ? <span className="cw-dim cw-cheat-desc">{mod.desc}</span> : null}
        </span>
        <span className={`cw-tag${mod.on && !mod.button ? " is-on" : ""}`}>{tag}</span>
      </button>
    </li>
  );
}

function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  return (
    <button type="button" className="cw-focusable cw-button" data-action="cheats-refresh" onClick={onRefresh}>
      <RefreshCw aria-hidden />
      <span>{t("cw_cheats_refresh")}</span>
    </button>
  );
}

/** An empty state: what is true, what to do next, and Refresh. */
function Empty({ title, next, onRefresh, tone }: { title: string; next?: string; onRefresh: () => void; tone?: "error" }) {
  return (
    <div className={`cw-card cw-cheats-empty${tone === "error" ? " is-error" : ""}`} role={tone === "error" ? "alert" : "status"}>
      <p className="cw-cheats-empty-title">{title}</p>
      {next ? <p className="cw-dim">{next}</p> : null}
      <RefreshButton onRefresh={onRefresh} />
    </div>
  );
}

/** Cheats without state: everything comes in through props (tests render it directly). */
export function CheatsView(p: CheatsViewProps) {
  const phase = cheatsPhase(p.state);
  const s = p.state;
  const title = phase.kind === "list" || phase.kind === "none" ? phase.title : null;

  let body;
  switch (phase.kind) {
    case "loading":
      body = <p className="cw-dim">{t("cw_cheats_loading")}</p>;
      break;
    case "error":
      body = <Empty title={phase.text} onRefresh={p.onRefresh} tone="error" />;
      break;
    case "no_game":
      body = <Empty title={t("cw_cheats_no_game")} next={t("cw_cheats_no_game_next")} onRefresh={p.onRefresh} />;
      break;
    case "exited":
      body = <Empty title={t("cw_cheats_exited")} next={t("cw_cheats_exited_next")} onRefresh={p.onRefresh} />;
      break;
    case "none":
      body = <Empty title={t("cw_cheats_none")} next={t("cw_cheats_none_next")} onRefresh={p.onRefresh} />;
      break;
    case "list":
      body = (
        <>
          <ul className="cw-cheats">
            {phase.list.mods.map((m) => (
              <CheatRow key={m.index} mod={m} busy={s.busy === m.index} disabled={s.busy !== null} onToggle={p.onToggle} />
            ))}
          </ul>
          {phase.list.truncated ? <p className="cw-dim cw-cheats-note">{t("cw_cheats_truncated")}</p> : null}
        </>
      );
      break;
  }

  return (
    <div className="cw-cheats-section">
      <h1 className="cw-h1">{t("cw_cheats_title")}</h1>
      {title ? (
        <section className="cw-card cw-game" aria-label={t("cw_home_now_running")}>
          {p.cover ? (
            <img className="cw-game-cover" src={p.cover} alt="" onError={p.onCoverError} />
          ) : (
            <Gamepad2 className="cw-game-icon" aria-hidden />
          )}
          <div className="cw-game-text">
            <div className="cw-dim">{t("cw_home_now_running")}</div>
            <div className="cw-game-title">{title}</div>
            <div className="cw-dim cw-cheats-how">
              {s.status && !s.status.engine ? t("cw_cheats_engine_off") : t("cw_cheats_how")}
            </div>
          </div>
          <RefreshButton onRefresh={p.onRefresh} />
        </section>
      ) : null}
      {s.message ? (
        <div className="cw-msg is-error" role="alert">
          {s.message}
        </div>
      ) : null}
      {body}
    </div>
  );
}

/** □ on a focused cheat inside `root`: that cheat's index, or null. */
export function focusedCheatIndex(root: Element | null, active: Element | null): number | null {
  if (!root || !active || !root.contains(active)) return null;
  const el = active.closest("[data-cheat-index]");
  if (!el) return null;
  const n = Number(el.getAttribute("data-cheat-index"));
  return Number.isInteger(n) ? n : null;
}

/** The Cheats section: the running game's cheats, each switched on or off from the controller. */
export function Cheats() {
  const [state, setState] = useState<CheatsState>(EMPTY_STATE);
  const ctl = useRef<CheatsController | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Opening the section reads at once; then the status every few seconds while the page shows.
  // Coming back to the page (it was hidden) reads the cheats again too: the PC may have changed them.
  useEffect(() => {
    const c = createCheatsController(setState);
    ctl.current = c;
    const stop = pollWhileVisible(() => void c.loadStatus(), CHEATS_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void c.loadList();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
      c.dispose();
      ctl.current = null;
    };
  }, []);

  // Create re-reads (App's fallback still re-reads the console status); □ switches the focused cheat.
  useEffect(
    () =>
      onNavAction(
        (a) => {
          const c = ctl.current;
          if (!c) return false;
          if (a === "refresh") {
            void c.refresh();
            return false;
          }
          if (a === "select") {
            const index = focusedCheatIndex(root.current, document.activeElement);
            if (index == null) return false;
            const mod = c.get().list?.mods.find((m) => m.index === index);
            if (mod) void c.toggle(mod);
            return true;
          }
          return false;
        },
        () => root.current,
      ),
    [],
  );

  const titleId = state.status?.game?.title_id ?? null;
  const loadedCover = useAppCover(titleId);
  const [coverFailed, setCoverFailed] = useState<string | null>(null);
  const cover = loadedCover && coverFailed !== loadedCover ? loadedCover : null;

  return (
    <div ref={root}>
      <CheatsView
        state={state}
        cover={cover}
        onCoverError={() => setCoverFailed(loadedCover)}
        onToggle={(m) => void ctl.current?.toggle(m)}
        onRefresh={() => void ctl.current?.refresh()}
      />
    </div>
  );
}
