import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Send } from "lucide-react";

import { Button } from "./Button";
import { Callout } from "./Callout";
import { Modal } from "./Modal";
import { Spinner } from "./Spinner";
import { formatBytes } from "../lib/format";
import {
  SHARE_COPY_LIMIT,
  copyDecision,
  shareTarget,
  type IncomingItem,
} from "../lib/incomingShare";
import { chooseArchive } from "../state/archiveInstall";
import { useConnectionStore } from "../state/connection";
import { engineIsOnThisDevice } from "../state/engine";
import {
  dismissFirstShare,
  installIncomingShare,
  startShareCopy,
  useIncomingShareStore,
} from "../state/incomingShare";
import { useTr } from "../state/lang";
import { useActiveProfile } from "../state/roster";

/**
 * "Send to <console>?" for what reached the app from outside: a link or a file shared from
 * another Android app, or a .pkg opened with the desktop app. Shows what arrived and sends it
 * only on Confirm, through the screens that already do it: a link fills in Install from a
 * link (where the way to fetch it is chosen and the install started), a package streams and
 * installs like a dropped one, an archive opens in Install packages from an archive.
 */
export function IncomingShareSheet() {
  const tr = useTr();
  const navigate = useNavigate();
  const item = useIncomingShareStore((s) => s.queue[0] ?? null);
  const copying = useIncomingShareStore((s) => s.copying);
  const copyError = useIncomingShareStore((s) => s.copyError);
  const approved = useIncomingShareStore((s) => s.approved);
  const host = useConnectionStore((s) => s.host);
  const helperUp = useConnectionStore((s) => s.payloadStatus === "up");
  const profile = useActiveProfile();

  useEffect(() => {
    installIncomingShare();
  }, []);

  const target = item ? shareTarget(item) : null;
  const hasHost = !!host?.trim();
  const fileItem = item?.kind === "path" || item?.kind === "stream";
  // A path is on this device; an engine on another computer cannot open it.
  const remoteEngine = fileItem && !engineIsOnThisDevice();
  const tooLarge =
    item?.kind === "stream" && copyDecision(item.size) === "too_large";
  const ready =
    !!item &&
    (target === "link" || target === "package" || target === "archive") &&
    hasHost &&
    // A link only fills in the form; the install itself waits for the console there.
    (target === "link" || helperUp) &&
    !remoteEngine &&
    !tooLarge &&
    copyError !== "too_large" &&
    !copying;

  function send(it: IncomingItem) {
    if (it.kind === "url") {
      navigate("/send", { state: { sharedLink: it.url } });
    } else if (it.kind === "path") {
      if (shareTarget(it) === "archive") {
        void chooseArchive(host, it.path);
        navigate("/send");
      } else {
        navigate("/send", { state: { droppedPath: it.path } });
      }
    } else {
      return;
    }
    dismissFirstShare();
  }

  // A stream copied after the user said yes goes on without a second question.
  useEffect(() => {
    if (approved && item?.kind === "path") send(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approved, item]);

  if (!item) return null;

  function confirm() {
    if (!item || !ready) return;
    if (item.kind === "stream") {
      startShareCopy(item.token, SHARE_COPY_LIMIT);
      return;
    }
    send(item);
  }

  const consoleName = profile?.name || host;
  const title = consoleName
    ? tr("share.title", { console: consoleName }, "Send to {console}?")
    : tr("share.title_any", undefined, "Send to PS5?");

  const label =
    item.kind === "url"
      ? item.url
      : item.kind === "text"
        ? item.text
        : item.name;
  const size = item.kind === "path" || item.kind === "stream" ? item.size : null;
  const detail = item.kind === "path" && !item.copied ? item.path : null;
  const limitText = formatBytes(SHARE_COPY_LIMIT);

  const note = (() => {
    switch (target) {
      case "link":
        return tr(
          "share.note.link",
          undefined,
          "The link is filled in under Install from a link, where you choose how it is fetched and start the install.",
        );
      case "package":
        return tr(
          "share.note.package",
          undefined,
          "The package is streamed to the PS5 and installed. Nothing is copied to the PS5 first.",
        );
      case "archive":
        return tr(
          "share.note.archive",
          undefined,
          "The archive opens under Install packages from an archive, which lists the packages inside. Install them from there.",
        );
      case "no_link":
        return tr("share.no_link", undefined, "No link was found in what was shared.");
      default:
        return tr(
          "share.unsupported",
          undefined,
          "PS5Upload installs .pkg and .fpkg packages and ZIP, 7z or RAR archives. This is none of those.",
        );
    }
  })();

  const problem = (() => {
    if (tooLarge || copyError === "too_large")
      return tr(
        "share.too_large",
        { limit: limitText },
        "This file is bigger than {limit}, too big to copy into the app. Download it to the phone first (for example to Download), then share it again from the Files app.",
      );
    if (copyError === "no_space")
      return tr(
        "share.no_space",
        undefined,
        "There is not enough free space on the phone to copy it into the app.",
      );
    if (copyError === "copy_failed")
      return tr(
        "share.copy_failed",
        undefined,
        "The file could not be read from the app that shared it. Download it to the phone first, then share it again from the Files app.",
      );
    if (remoteEngine)
      return tr(
        "share.remote_engine",
        undefined,
        "This app is using an engine on another computer, which cannot open files on this one.",
      );
    if (target !== "link" && target !== "package" && target !== "archive") return null;
    if (!hasHost || (target !== "link" && !helperUp))
      return tr(
        "share.not_connected",
        undefined,
        "Connect to a PS5 first. This waits here until you send it or cancel.",
      );
    return null;
  })();

  return (
    <Modal
      open
      onClose={dismissFirstShare}
      title={title}
      titleIcon={<Send size={15} aria-hidden />}
      variant="sheet"
      closeOnScrim={false}
      bodyClassName="p-4 sm:p-5"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={dismissFirstShare}>
            {tr("cancel", undefined, "Cancel")}
          </Button>
          {(target === "link" || target === "package" || target === "archive") && (
            <Button
              variant="primary"
              size="sm"
              onClick={confirm}
              disabled={!ready}
              data-testid="incoming-share-send"
            >
              {copying && <Spinner size={13} />}
              {tr("share.send", undefined, "Send")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3" data-testid="incoming-share">
        <div>
          <div className="break-all text-sm font-semibold">{label}</div>
          {(size !== null || detail) && (
            <div className="mt-0.5 break-all text-xs text-[var(--color-muted)]">
              {[size !== null ? formatBytes(size) : null, detail].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <p className="text-sm text-[var(--color-muted)]">{note}</p>
        {item.kind === "stream" && !tooLarge && !copyError && (
          <p className="text-sm text-[var(--color-muted)]">
            {copying
              ? tr("share.copying", undefined, "Copying it into the app…")
              : tr(
                  "share.note.copy",
                  { limit: limitText },
                  "Only the app that shared it can read this file, so it is copied into this app first (up to {limit}).",
                )}
          </p>
        )}
        {problem && <Callout tone="warn" title={problem} />}
      </div>
    </Modal>
  );
}
