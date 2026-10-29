import { KeyRound, MonitorPlay } from "lucide-react";
import { useNavigate } from "react-router";

import { Button, PageHeader } from "../../components";
import { useTr } from "../../state/lang";
import { useRemotePlayStore } from "../../state/remotePlay";
import { COMPACT_QUERY, useMedia } from "./immersive";
import { StreamPanel } from "./StreamPanel";

/**
 * Remote Play: a console's screen streamed into the app, played with a controller or the
 * keyboard (the chiaki-ng port, engine rp_stream). Pairing Sony's own PS Remote Play app, and
 * the console settings Remote Play needs, are in Accounts' Remote Play section.
 */
export default function PlayScreen() {
  const tr = useTr();
  const navigate = useNavigate();
  const compact = useMedia(COMPACT_QUERY);
  const streaming = useRemotePlayStore(
    (s) => !!s.stream && s.phase !== null && s.phase !== "ended",
  );
  // On a phone the picture and its controller need the height: while playing, the header is
  // just the title.
  const lean = compact && streaming;
  return (
    <div className="app-page space-y-4">
      <PageHeader
        icon={MonitorPlay}
        title={tr("play_title", undefined, "Remote Play")}
        description={
          lean
            ? undefined
            : tr(
                "rp_play_description2",
                undefined,
                "Stream a PS5 into this app and play it with a controller, the keyboard or touch. It wakes a console in rest mode on its own, and keeps playing while you use other screens.",
              )
        }
        right={
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<KeyRound size={14} />}
            onClick={() => navigate("/accounts#remote-play")}
          >
            {tr("play_setup", undefined, "Remote Play Setup")}
          </Button>
        }
      />
      <StreamPanel />
    </div>
  );
}
