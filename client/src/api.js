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

  if (!res.ok) throw new ApiError(res.status, parsed);
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

  deck: (since = 0) => request(`/deck${query({ since })}`),
  queue: (opts) => request(`/queue${query(opts)}`),
  browse: (opts) => request(`/browse${query(opts)}`),
  star: (cardId, starred) => request("/stars", { method: "POST", body: { cardId, starred } }),
  events: (events) => request("/events", { method: "POST", body: { events } }),
  stats: () => request("/stats"),
};
