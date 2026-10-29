import { Play, Square } from "lucide-react";

import { Spinner } from "../../components";
import { useTr } from "../../state/lang";

/**
 * What a grid card's Play control shows for a game installed on the selected console:
 * - `play`: it can start; `wait`: another game is starting, so Play waits its turn;
 * - `starting` / `closing`: this game is starting or being closed;
 * - `running`: it runs now, so the control closes it;
 * - `blocked`: it runs from a disk image and ShadowMount+ is not running.
 */
export type PlayState =
  "play" | "wait" | "starting" | "running" | "closing" | "blocked";

/**
 * Play (or Close game) for an installed game, beside its cover or in its table row: always
 * shown (a phone has no hover), its own button so a press never opens the game's page.
 * `cover`: a round control in the cover's corner, with its label from `sm` up; `row`: a compact
 * pill for the table. The actions are useGameLaunch's, owned by the grid.
 */
export function PlayControl({
  state,
  title,
  onPlay,
  onStop,
  variant = "cover",
}: {
  state: PlayState;
  /** The game's name, for the accessible label. */
  title: string;
  onPlay: () => void;
  onStop: () => void;
  variant?: "cover" | "row";
}) {
  const tr = useTr();
  const busy = state === "starting" || state === "closing";
  const stop = state === "running" || state === "closing";
  const label =
    state === "starting"
      ? tr("game_hub_launching", undefined, "Starting…")
      : state === "closing"
        ? tr("installed_stopping", undefined, "Closing…")
        : state === "running"
          ? tr("game_close_short", undefined, "Close")
          : state === "blocked"
            ? tr("installed_needs_smp", undefined, "Needs SMP")
            : tr("game_play", undefined, "Play");
  const hint =
    state === "blocked"
      ? tr(
          "installed_play_needs_smp",
          undefined,
          "Needs ShadowMount+ running to mount and launch",
        )
      : state === "wait"
        ? tr("game_play_wait", undefined, "Another game is starting")
        : state === "running"
          ? tr("installed_stop", undefined, "Close game")
          : undefined;
  const aria = `${
    state === "running" ? tr("installed_stop", undefined, "Close game") : label
  }: ${title}`;
  const disabled = busy || state === "blocked" || state === "wait";

  const tone = stop
    ? "border border-[color-mix(in_srgb,var(--color-bad)_45%,transparent)] bg-[var(--color-float)] text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)]"
    : state === "blocked"
      ? "border border-[var(--glass-edge)] bg-[var(--color-float)] text-[var(--color-muted)]"
      : "border border-transparent bg-[image:var(--accent-fill)] text-[var(--color-accent-contrast)] shadow-[var(--accent-glow)] hover:brightness-105";
  const icon = busy ? (
    <Spinner size={13} tone="inherit" />
  ) : stop ? (
    <Square size={12} fill="currentColor" aria-hidden />
  ) : (
    <Play
      size={14}
      fill="currentColor"
      aria-hidden
      className="translate-x-px"
    />
  );
  const shape =
    variant === "cover"
      ? // A 40px round target on a phone; a pill with its label where the card is wider.
        "size-10 justify-center rounded-full sm:size-auto sm:h-9 sm:gap-1.5 sm:px-3.5 shadow-[var(--shadow-2)]"
      : "h-8 gap-1.5 rounded-full px-3";
  const labelClass =
    variant === "cover"
      ? "hidden whitespace-nowrap sm:inline"
      : "whitespace-nowrap";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (stop) onStop();
        else onPlay();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      disabled={disabled}
      aria-label={aria}
      aria-busy={busy || undefined}
      title={hint ?? aria}
      data-testid="card-play"
      data-state={state}
      className={`inline-flex shrink-0 items-center text-xs font-semibold transition-[filter,background-color,opacity] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed ${
        state === "wait" ? "disabled:opacity-60" : ""
      } ${shape} ${tone}`}
    >
      {icon}
      <span className={labelClass}>{label}</span>
    </button>
  );
}
