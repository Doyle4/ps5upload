import { Navigate, useLocation } from "react-router";

import { filesViewLink } from "../FileSystem/filesViews";

/** Search lives in Files now (`SearchPanel`). The old route lands there with search open,
 *  keeping a game's page's "search this game's files" scope. */
export default function SearchScreen() {
  const location = useLocation();
  const id = (location.state as { titleId?: unknown } | null)?.titleId;
  return <Navigate to={filesViewLink("search", { title: typeof id === "string" ? id : undefined })} replace />;
}
