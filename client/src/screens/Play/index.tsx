import { KeyRound, MonitorPlay } from "lucide-react";
import { useNavigate } from "react-router";

import { Button, PageHeader } from "../../components";
import { useTr } from "../../state/lang";
import { StreamPanel } from "./StreamPanel";

/**
 * Play (beta): a console's screen streamed into the app, played with a controller or the
 * keyboard (the chiaki-ng port, engine rp_stream). Pairing Sony's own PS Remote Play app, and
 * the console settings Remote Play needs, are in Accounts' Remote Play section.
 */
export default function PlayScreen() {
  const tr = useTr();
  const navigate = useNavigate();
  return (
    <div className="app-page space-y-4">
      <PageHeader
        icon={MonitorPlay}
        title={tr("play_title", undefined, "Play")}
        description={tr(
          "rp_play_description",
          undefined,
          "Stream a PS5 into this app and play it with a controller or the keyboard. It wakes a console in rest mode on its own.",
        )}
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
