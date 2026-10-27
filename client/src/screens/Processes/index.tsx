import { Navigate, useSearchParams } from "react-router";

/**
 * The old /processes screen. Processes and Ports are tabs of Payloads & processes now;
 * an old link (`/processes`, `/processes?tab=ports`) opens the matching tab there.
 */
export default function ProcessesScreen() {
  const [params] = useSearchParams();
  return <Navigate to={params.get("tab") === "ports" ? "/payloads?tab=ports" : "/payloads?tab=processes"} replace />;
}
