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
 * A dead connection fails `fetch()` fast; a bad one does not. On a weak
 * signal the request neither succeeds nor is refused — it stalls — and
 * without a bound `await api.me()` at boot (§ app.js) waits on it forever,
 * leaving the screen the app has not painted anything onto yet: black,
 * because that is `--night`. The device already has an answer for this case
 * (the remembered signed-in user, a cached deck), it just never reaches it.
 * Ten seconds is long enough for a slow reply and short enough that "the app
 * did not open" does not sit there for minutes before it does.
 *
 * The bound covers the body as well as the headers. It used to be cleared as
 * soon as `fetch()` resolved, which is when the status line arrives — so a
 * reply that started and then stalled, the likely shape in a train tunnel,
 * hung in `res.text()` with nothing left to stop it. Measured in WebKit
 * against a server that sends headers and half a body: still hanging at 25 s
 * before, OfflineError at 10 s after (#72).
 */
export const REQUEST_TIMEOUT_MS = 10000;

/**
 * How long a screen waits for the server before it goes on with what the
 * device already holds (#106).
 *
 * The timeout above is when a request is given up. That is the wrong moment
 * to fall back: the cached queue and the cached deck were on the device the
 * whole time, and a session start on a stalled connection sat on "…" for all
 * ten seconds of it (measured on the live app, v41: 10.16 s to the first
 * card). A request that has not answered in a second and a half is no longer
 * "quick"; one from Tokyo to this server on a working connection answers well
 * inside it.
 */
export const PATIENCE_MS = 1500;

/**
 * The promise's outcome if it settles within `ms`, otherwise `undefined` — and
 * the promise keeps running, so a late answer can still be put to use.
 *
 * `{ value }` or `{ error }`, rather than a rejection, so the caller decides
 * what a failure means; and a rejection that arrives after the wait is caught
 * here, since nobody may be listening for it any more.
 */
export function answerSoon(promise, ms = PATIENCE_MS) {
  let timer;
  const outcome = promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  const late = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([outcome, late]).finally(() => clearTimeout(timer));
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

/**
 * `blob` is a recording's raw bytes (#183 follow-up) — sent as-is, with its
 * own content-type, rather than JSON.stringify'd like every other body here.
 */
async function request(path, { method = "GET", body, blob, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });

  let res;
  let text;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      signal: controller.signal,
      credentials: "same-origin",
      headers: {
        // The zone, not the date (#122): the server counts "today" from
        // midnight where the device is, but from the log's own timestamps.
        "x-time-zone": Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(blob ? { "content-type": blob.type || "audio/webm" } : body ? { "content-type": "application/json" } : {}),
      },
      body: blob ?? (body ? JSON.stringify(body) : undefined),
    });
    text = await res.text();
  } catch {
    // An abort rejects the body read too, and a connection lost part way
    // through a reply is no less offline than one lost before it.
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }

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
  // #137: her decks with their cards for today, for the practise tab.
  decks: () => request("/decks"),
  updateDeckSettings: (deckKey, patch) =>
    request("/decks/settings", { method: "PATCH", body: { deckKey, ...patch } }),
  // #179: one more batch of new cards for today, in this deck.
  releaseNewCards: (deckKey) => request("/decks/new-cards", { method: "POST", body: { deckKey } }),
  // #137: her own decks, made, renamed and deleted from the app.
  createDeck: (name) => request("/decks", { method: "POST", body: { name } }),
  renameDeck: (id, name) => request(`/decks/${id}`, { method: "PATCH", body: { name } }),
  deleteDeck: (id) => request(`/decks/${id}`, { method: "DELETE" }),
  browse: (opts) => request(`/browse${query(opts)}`),
  star: (cardId, starred, changedAt) =>
    request("/stars", { method: "POST", body: { cardId, starred, changedAt } }),
  // #35: the whole set of her topics for one card, not an addition — see the
  // route's comment for why the client is not asked to compute a difference.
  setCardTags: (cardId, tags) =>
    request(`/cards/${cardId}/tags`, { method: "PUT", body: { tags } }),
  events: (events) => request("/events", { method: "POST", body: { events } }),
  // #183 follow-up: her own or a native speaker's recording of one card, kept
  // apart only by `kind` — both are made under her own session (recording.js).
  addRecording: (cardId, kind, id, blob) =>
    request(`/cards/${cardId}/recordings${query({ kind, id })}`, { method: "POST", blob }),
  deleteRecording: (cardId, id) => request(`/cards/${cardId}/recordings/${id}`, { method: "DELETE" }),
  // #185 follow-up: one card's recordings outside a session's queue, for the
  // deck's card menu.
  cardRecordings: (cardId) => request(`/cards/${cardId}/recordings`),
  stats: () => request("/stats"),
  // #98: one card's own record — her reviews of it, and when it is due.
  cardHistory: (cardId) => request(`/cards/${cardId}/history`),

  cards: () => request("/cards"),
  addCard: (card) => request("/cards", { method: "POST", body: card }),
  // #85: the whole card, like adding one — see the route for why not a patch.
  updateCard: (id, card) => request(`/cards/${id}`, { method: "PUT", body: card }),
  deleteCard: (id) => request(`/cards/${id}`, { method: "DELETE" }),

  settings: () => request("/settings"),
  updateSettings: (patch) => request("/settings", { method: "PATCH", body: patch }),
};
