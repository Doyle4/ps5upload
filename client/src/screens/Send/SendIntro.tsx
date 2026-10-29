import { FolderUp, Link2, Package } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../components";
import { useTr } from "../../state/lang";
import { OPEN_FOLD, SEND_CHOOSE_PACKAGE } from "./sendEvents";

function Choice({
  icon,
  title,
  body,
  action,
  testId,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action: ReactNode;
  testId: string;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-[var(--edge-highlight),var(--shadow-1)]"
      data-testid={testId}
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent-bright)]">
          {icon}
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <p className="flex-1 text-xs leading-relaxed text-[var(--color-muted)]">{body}</p>
      <div>{action}</div>
    </div>
  );
}

/**
 * What Send to PS5 does, said first: install packages, copy games and files, or install from a
 * link or a drive. Each choice starts the part of the page below that does it, so the page
 * reads as three jobs rather than one drop zone that "works out what to do".
 */
export function SendIntro() {
  const tr = useTr();
  const scrollTo = (testId: string) =>
    document.querySelector(`[data-testid="${testId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-3" data-testid="send-intro">
      <Choice
        testId="send-choice-install"
        icon={<Package size={18} aria-hidden />}
        title={tr("send_choice_install", undefined, "Install a package")}
        body={tr(
          "send_choice_install_body",
          undefined,
          ".pkg or .fpkg from this computer or a saved server. It installs on the PS5 as a game, update or DLC: streamed straight to the installer, or uploaded first.",
        )}
        action={
          <Button size="sm" variant="primary" onClick={() => window.dispatchEvent(new Event(SEND_CHOOSE_PACKAGE))}>
            {tr("send_choice_install_btn", undefined, "Choose a package…")}
          </Button>
        }
      />
      <Choice
        testId="send-choice-copy"
        icon={<FolderUp size={18} aria-hidden />}
        title={tr("send_choice_copy", undefined, "Copy a game or files")}
        body={tr(
          "send_choice_copy_body",
          undefined,
          "A game folder (it can go on the home screen), an .exfat or .ffpfs image (it can be mounted), an archive, or any file. Drop it below or choose it.",
        )}
        action={
          <Button size="sm" onClick={() => scrollTo("send-drop")}>
            {tr("send_choice_copy_btn", undefined, "Drop or choose below")}
          </Button>
        }
      />
      <Choice
        testId="send-choice-link"
        icon={<Link2 size={18} aria-hidden />}
        title={tr("send_choice_link", undefined, "Install from a link or a drive")}
        body={tr(
          "send_choice_link_body",
          undefined,
          "A package's web link, the packages inside an archive, or packages already on the PS5 or a USB drive plugged into it.",
        )}
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_FOLD, { detail: "send-more" }))}>
              {tr("send_choice_link_btn", undefined, "From a link")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_FOLD, { detail: "send-on-ps5" }))}>
              {tr("send_choice_drive_btn", undefined, "On the PS5 or USB")}
            </Button>
          </div>
        }
      />
    </div>
  );
}
