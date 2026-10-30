import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { PadApp } from "../../pad/PadApp";
import { getEngineUrl } from "../../state/engine";
import { focusForControllers, holdPageStill, lockLandscape, setWindowFullscreen, unlockOrientation } from "./immersive";

/** This app's engine relays to another computer's controller socket (pad_link.rs relay): an
 *  app page may not open a plain ws:// to another machine, its own loopback it may. */
export function relayUrl(engineUrl: string, target: string): string {
  const base = engineUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return `${base}/api/ps5/rp/pad-relay?url=${encodeURIComponent(target)}`;
}

/** This phone as the controller of a Remote Play session another device runs
 *  (/play/pad?url=<its pad socket>&name=<its name>): full screen and sideways. */
export default function PadRemote() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const target = params.get("url") ?? "";
  const computer = params.get("name") ?? "";
  const url = useMemo(() => relayUrl(getEngineUrl(), target), [target]);

  useEffect(() => {
    holdPageStill(true);
    void setWindowFullscreen(true);
    lockLandscape();
    focusForControllers();
    return () => {
      unlockOrientation();
      void setWindowFullscreen(false);
      holdPageStill(false);
    };
  }, []);

  return <PadApp url={url} computer={computer} onLeave={() => navigate("/play")} />;
}
