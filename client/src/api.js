/**
 * The API client.
 *
 * Everything lives under /kotoba/ so the service worker scope, the manifest
 * scope and the session cookie path stay aligned (§2). The base is derived from
 * where the app itself was served, so the same build works at the root during
 * development and under /kotoba/ in production.
 */
// Guarded so the module can be imported by a test runner with no DOM.
const documentBase =
  typeof document !== "undefined" ? document.baseURI : "http://localhost/";
const base = new URL("./", documentBase).pathname.replace(/\/$/, "");

export const API = `${base}/api`;

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** Thrown when the network is unreachable, as opposed to the server saying no. */
export class OfflineError extends Error {
  constructor() {
    super("offline");
  }
}

/**
 * The server saying the cookie is gone (design 52) rather than saying a PIN is
 * wrong. Both are 401 and only the body separates them: `unauthenticated` comes
 * from the session guard, `invalid_credentials` from the login route.
 *
 * Told apart by the body rather than by the path deliberately — a wrong PIN
 * typed *into* 52 must not re-fire the screen it was typed into, which would
 * clear the cells and the rate-limit countdown along with them.
 */
export function isSessionExpired(err) {
  return err instanceof ApiError && err.status === 401 && err.body?.error === "unauthenticated";
}

const expiredListeners = new Set();

/** Called whenever a request comes back with an expired session cookie. */
export function onSessionExpired(fn) {
  expiredListeners.add(fn);
  return () => expiredListeners.delete(fn);
}

async function request(path, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      signal,
      credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new OfflineError();
  }

  const text = await res.text();
  const parsed = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const err = new ApiError(res.status, parsed);
    // Announced here rather than at each call site: every request can be the
    // one that discovers the cookie has gone, and the shell needs to know
    // whichever one it was.
    if (isSessionExpired(err)) for (const fn of expiredListeners) fn();
    throw err;
  }
  return parsed;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const query = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
};

export const api = {
  login: (handle, pin) => request("/auth/login", { method: "POST", body: { handle, pin } }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/me"),

  deck: (since = 0, page) => request(`/deck${query({ since, ...page })}`),
  queue: (opts) => request(`/queue${query(opts)}`),
  browse: (opts) => request(`/browse${query(opts)}`),
  star: (cardId, starred) => request("/stars", { method: "POST", body: { cardId, starred } }),
  events: (events) => request("/events", { method: "POST", body: { events } }),
  stats: () => request("/stats"),

  cards: () => request("/cards"),
  addCard: (card) => request("/cards", { method: "POST", body: card }),
  deleteCard: (id) => request(`/cards/${id}`, { method: "DELETE" }),

  settings: () => request("/settings"),
  updateSettings: (patch) => request("/settings", { method: "PATCH", body: patch }),
};
