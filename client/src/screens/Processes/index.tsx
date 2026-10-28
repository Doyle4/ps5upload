import { Navigate } from "react-router";

import { RUNNING_LINK } from "../Payloads/payloadTabs";

/**
 * The old /processes screen. Processes and Ports are one Running tab of Payloads now; an old
 * link (`/processes`, `/processes?tab=ports`) opens it.
 */
export default function ProcessesScreen() {
  return <Navigate to={RUNNING_LINK} replace />;
}
