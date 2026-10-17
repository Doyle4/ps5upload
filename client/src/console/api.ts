/**
 * The console page's client for the helper's web API.
 *
 * Every route is POST + JSON and needs the per-start token in X-PS5U-Token.
 * The page reads the token once from GET /api/token (same origin; another
 * site's page cannot read that response). A 401 {"error":"token"} means the
 * helper restarted and issued a new token: the page must be reloaded, so
 * onTokenExpired listeners hear about it (the ReloadBanner).
 */

export const TOKEN_HEADER = "X-PS5U-Token";

/** A failed call. status 0 = the request never got an answer. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** The helper is not answering (network failure) or is shutting down (503 stopping). */
export function isOffline(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.code === "stopping");
}

const expiredListeners = new Set<() => void>();

/** Called on every 401 from the API. Returns the unsubscribe function. */
export function onTokenExpired(fn: () => void): () => void {
  expiredListeners.add(fn);
  return () => {
    expiredListeners.delete(fn);
  };
}

let tokenPromise: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/token", { method: "GET", credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "offline");
  }
  if (!res.ok) throw new ApiError(res.status, res.status === 503 ? "stopping" : "token_unavailable");
  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== "string" || !body.token) throw new ApiError(res.status, "token_unavailable");
  return body.token;
}

function token(): Promise<string> {
  if (!tokenPromise) {
    tokenPromise = fetchToken();
    // A failed read is not cached: the next call asks again.
    tokenPromise.catch(() => {
      tokenPromise = null;
    });
  }
  return tokenPromise;
}

/** POST `body` as JSON to `route`; the Response when it is 2xx, else the ApiError. */
async function post(route: string, body?: object, signal?: AbortSignal): Promise<Response> {
  const tok = await token();
  let res: Response;
  try {
    res = await fetch(route, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", [TOKEN_HEADER]: tok },
      body: JSON.stringify(body ?? {}),
      signal,
    });
  } catch {
    throw new ApiError(0, "offline");
  }
  if (res.status === 401) {
    for (const fn of Array.from(expiredListeners)) fn();
    throw new ApiError(401, "token");
  }
  if (!res.ok) {
    const json: unknown = await res.json().catch(() => null);
    const code =
      json && typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : `http_${res.status}`;
    throw new ApiError(res.status, code);
  }
  return res;
}

/** POST `body` as JSON to `route` and return the parsed JSON reply. */
export async function call<T>(route: string, body?: object): Promise<T> {
  const res = await post(route, body);
  return (await res.json().catch(() => null)) as T;
}

/** POST `body` as JSON to `route` and return the raw reply (/api/fs/read's bytes). `signal` aborts it. */
export async function callBlob(route: string, body?: object, signal?: AbortSignal): Promise<Blob> {
  const res = await post(route, body, signal);
  return res.blob();
}
