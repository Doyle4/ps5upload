import { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";

import type { CollectionGame } from "../../api/collection";
import { Button, Checkbox, Modal } from "../../components";
import { hostOf } from "../../lib/addr";
import { sendGamesTo, type SendResult } from "../../lib/collectionActions";
import { useTr } from "../../state/lang";
import { pushNotification } from "../../state/notifications";
import { useRosterStore } from "../../state/roster";

/** Sends the selected games to one or more consoles: each console gets what it lacks of each
 *  game (base package, or folder, image or archive) and the newer updates and DLC of what it
 *  has. Games a console already has, up to date, are left alone. */
export function SendManyModal({
  open,
  games,
  host,
  onClose,
  onSent,
}: {
  open: boolean;
  games: CollectionGame[];
  /** The connected console: ticked to start with. */
  host: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const tr = useTr();
  const profiles = useRosterStore((s) => s.profiles);
  const consoles = useMemo(() => {
    const out = profiles
      .filter((p) => p.host?.trim())
      .map((p) => ({ host: p.host.trim(), name: p.name || p.host.trim() }));
    if (host && !out.some((c) => hostOf(c.host) === hostOf(host))) {
      out.unshift({ host, name: host });
    }
    return out;
  }, [profiles, host]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setPicked(new Set(host ? [host] : []));
  }, [open, host]);

  const send = async () => {
    setBusy(true);
    const results: SendResult[] = [];
    for (const c of consoles.filter((c) => picked.has(c.host))) {
      results.push(await sendGamesTo(c.host, games));
    }
    setBusy(false);
    for (const r of results) {
      const name = consoles.find((c) => c.host === r.host)?.name ?? r.host;
      const parts = [
        tr("collection.sent_installs", { n: r.installs }, "{n} to install"),
        tr("collection.sent_uploads", { n: r.uploads }, "{n} to upload"),
      ];
      if (r.upToDate) {
        parts.push(
          tr(
            "collection.sent_uptodate",
            { n: r.upToDate },
            "{n} already there",
          ),
        );
      }
      if (r.nothing) {
        parts.push(
          tr(
            "collection.sent_nothing",
            { n: r.nothing },
            "{n} with nothing to send",
          ),
        );
      }
      pushNotification(
        r.installs + r.uploads > 0 ? "info" : "warning",
        tr("collection.sent_title", { name }, "Sent to {name}"),
        {
          body:
            parts.join(" · ") +
            (r.unread
              ? " " +
                tr(
                  "collection.sent_unread",
                  undefined,
                  "This PS5 could not be read, so games it may already have were queued too; an install that would replace one is refused.",
                )
              : ""),
          link: "/install-package",
        },
      );
    }
    onSent();
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={tr(
        "collection.send_many_title",
        { n: games.length },
        "Send {n} games",
      )}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            {tr("cancel", undefined, "Cancel")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Send size={13} />}
            loading={busy}
            disabled={picked.size === 0 || games.length === 0}
            onClick={() => void send()}
          >
            {tr(
              "collection.send_many_go",
              { n: picked.size },
              "Send to {n} PS5(s)",
            )}
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-[var(--color-muted)]">
        {tr(
          "collection.send_many_body",
          undefined,
          "Each PS5 gets what it lacks: the game's package, or its folder, image or archive, plus newer updates and DLC for the games it has. Packages stream from this computer; the rest uploads to the drive set in Upload, in the homebrew folder.",
        )}
      </p>
      {consoles.length === 0 ? (
        <p className="text-sm text-[var(--color-warn)]">
          {tr(
            "collection.send_many_none",
            undefined,
            "No PS5 is set up yet. Add one in Connections first.",
          )}
        </p>
      ) : (
        <div className="grid gap-2">
          {consoles.map((c) => (
            <Checkbox
              key={c.host}
              checked={picked.has(c.host)}
              disabled={busy}
              onChange={(on) =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(c.host);
                  else next.delete(c.host);
                  return next;
                })
              }
              label={c.name === c.host ? c.host : `${c.name} · ${c.host}`}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
