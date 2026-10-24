import { memo } from "react";
import { useNavigate } from "react-router";
import { Copy as CopyIcon, ExternalLink, PackageOpen } from "lucide-react";

import type { CollectionGame, GameConsoleState } from "../../api/collection";
import { addOnCount, formatCollectionBytes } from "../../lib/collectionView";
import { useTr } from "../../state/lang";
import { CollectionCover } from "./CollectionCover";
import {
  CoverCaption,
  CoverFrame,
  CoverTag,
  MetaDot,
  PlatformTag,
} from "../../components/GameIconFrame";
import type { CopyActivity } from "../../state/copyActivity";
import {
  OverflowMenu,
  type OverflowMenuItem,
} from "../../components/OverflowMenu";
import { bestConvertible } from "../../lib/collectionConvert";

/** A game's quick actions, for its card and table row: open its page, or convert its best copy
 *  (a folder before an image, archive or base package) without opening the page first. */
export function GameQuickActions({
  game,
  onOpen,
}: {
  game: Pick<CollectionGame, "game_id" | "title" | "locations">;
  onOpen: (gameId: string) => void;
}) {
  const tr = useTr();
  const navigate = useNavigate();
  const convertible = bestConvertible(game.locations);
  const items: OverflowMenuItem[] = [
    {
      icon: <ExternalLink size={12} />,
      label: tr("game_open_page", undefined, "Open game page"),
      onSelect: () => onOpen(game.game_id),
    },
    ...(convertible
      ? [
          {
            icon: <PackageOpen size={12} />,
            label: tr("collection.convert", undefined, "Convert…"),
            title: tr(
              "collection.convert_hint",
              undefined,
              "Open it in Convert: make an installable package, or a different game image.",
            ),
            onSelect: () =>
              navigate("/convert", {
                state: { source: convertible.absolute_path },
              }),
          },
        ]
      : []),
  ];
  return (
    <OverflowMenu
      items={items}
      ariaLabel={`${tr("installed_more_actions", undefined, "More actions")}: ${game.title}`}
      buttonTitle={tr("installed_more_actions", undefined, "More actions")}
    />
  );
}

/** "1 copy · 2 add-ons": copies are full copies of the game, add-ons its updates and DLC. */
export function useCopiesLabel() {
  const tr = useTr();
  return (g: CollectionGame) => {
    const copies =
      g.copies === 1
        ? tr("collection.copies_one", undefined, "1 copy")
        : tr("collection.copies_n", { n: g.copies }, "{n} copies");
    const addOns = addOnCount(g);
    if (addOns === 0) return copies;
    const extra =
      addOns === 1
        ? tr("collection.addons_one", undefined, "1 add-on")
        : tr("collection.addons_n", { n: addOns }, "{n} add-ons");
    return `${copies} · ${extra}`;
  };
}

/** What the selected console has of this game, as a short badge; nothing when it lacks it. */
export function ConsoleBadge({ state }: { state?: GameConsoleState }) {
  const tr = useTr();
  if (!state?.installed) return null;
  if (state.update) {
    return (
      <CoverTag
        tone="accent"
        title={tr(
          "collection.badge_update_hint",
          { have: state.installed_version ?? "?", v: state.update.version },
          "The console has {have}; the collection has update {v}.",
        )}
      >
        {tr(
          "collection.badge_update",
          { v: state.update.version },
          "Update {v}",
        )}
      </CoverTag>
    );
  }
  return (
    <CoverTag tone="good">
      {state.installed_version
        ? tr(
            "collection.badge_installed_v",
            { v: state.installed_version },
            "Installed · {v}",
          )
        : tr("collection.badge_installed", undefined, "Installed")}
      {state.dlc_missing.length > 0
        ? ` · +${state.dlc_missing.length} DLC`
        : ""}
    </CoverTag>
  );
}

/** "Sending 34%", "Installing", "Queued", "Building": what is happening to the game right now. */
function ActivityBadge({ activity }: { activity: CopyActivity }) {
  const tr = useTr();
  const pct =
    "pct" in activity && activity.pct !== null ? ` ${activity.pct}%` : "";
  const label =
    activity.phase === "building"
      ? tr("collection.badge_building", undefined, "Building") + pct
      : activity.phase === "queued"
        ? tr("collection.badge_queued", undefined, "Queued")
        : activity.phase === "sending" && activity.installing
          ? tr("collection.badge_installing", undefined, "Installing") + pct
          : tr("collection.badge_sending", undefined, "Sending") + pct;
  return <CoverTag tone="accent">{label}</CoverTag>;
}

// Memoised: a big collection is hundreds of cards, and the screen re-renders on
// every keystroke in the search box.
export const CollectionCard = memo(function CollectionCard({
  game,
  onOpen,
  consoleState,
  activity,
}: {
  game: CollectionGame;
  onOpen: (gameId: string) => void;
  consoleState?: GameConsoleState;
  activity?: CopyActivity | null;
}) {
  const tr = useTr();
  const copiesLabel = useCopiesLabel();
  // The cover and the caption each open the game; the "⋯" menu beside the caption holds the
  // quick actions (a button cannot hold another, so the card is not one button any more).
  const open = () => onOpen(game.game_id);
  const focusRing =
    "rounded-[var(--radius-card)] text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]";
  return (
    <div className="group flex min-w-0 flex-col" data-testid="collection-card">
      <button
        type="button"
        onClick={open}
        className={focusRing}
        aria-label={game.title}
      >
        <CoverFrame
          interactive
          overlay={
            <>
              <div className="absolute left-2 top-2">
                <PlatformTag platform={game.platform} />
              </div>
              {game.is_duplicate && (
                <span className="absolute right-2 top-2">
                  <CoverTag
                    tone="warn"
                    icon={<CopyIcon size={11} aria-hidden />}
                    title={tr(
                      "collection.duplicate_hint",
                      undefined,
                      "More than one full copy of this game is on disk.",
                    )}
                  >
                    {tr("collection.duplicate", undefined, "Duplicate")}
                  </CoverTag>
                </span>
              )}
              <div className="absolute inset-x-2 bottom-2 flex flex-wrap items-end justify-between gap-1">
                <ConsoleBadge state={consoleState} />
                {activity &&
                  (activity.phase === "building" ||
                    activity.phase === "queued" ||
                    activity.phase === "sending") && (
                    <ActivityBadge activity={activity} />
                  )}
              </div>
            </>
          }
        >
          <CollectionCover game={game} className="h-full" />
        </CoverFrame>
      </button>
      <div className="flex min-w-0 items-start gap-1">
        <button
          type="button"
          onClick={open}
          className={`min-w-0 flex-1 ${focusRing}`}
          tabIndex={-1}
        >
          <CoverCaption
            title={game.title}
            titleAttr={`${game.title} · ${game.game_id}`}
            meta={
              <>
                <span className="truncate">{copiesLabel(game)}</span>
                <MetaDot />
                <span className="shrink-0 tabular-nums">
                  {formatCollectionBytes(game.total_size_bytes)}
                </span>
              </>
            }
          />
        </button>
        <div className="shrink-0 pt-1.5">
          <GameQuickActions game={game} onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
});
