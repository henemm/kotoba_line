/**
 * The flight recorder (#299): what the app did while nobody could see it.
 *
 * On 2026-09-26 Charlotte's iPad sat on "Deine Decks …" with 24 reviews
 * waiting, and nothing of it reached the server — the log ends at 11:33 JST,
 * her screenshot is from 12:56. What happened between the two could only be
 * guessed at (#297). So the app writes down, on the device, what it does:
 * starts and returns, every request with how long it took and how it ended,
 * which screen is up, anything that sits on "…" for more than a few seconds
 * and what it is waiting for, errors, and every attempt to send her reviews.
 * The next time a request gets through, it goes up (`ops/device-log.sh`
 * reads it back), and Settings → Diagnose shows the newest lines, for the
 * case where no request ever gets through.
 *
 * What it does not write: anything she typed or learned. A search is
 * "/browse", not what she searched for.
 *
 * localStorage rather than IndexedDB, deliberately. IndexedDB is where
 * everything else lives, so if it is ever the thing that hangs, a recorder
 * kept there would hang with it and record nothing. localStorage is
 * synchronous and cannot hang; it is also small, hence the cap and the week.
 */

const LOG = "trace.log";
const SENT = "trace.sent";
const DEVICE = "trace.device";
/** A week is enough to reach back to "on Saturday", and small. */
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** ~100 bytes a line; this keeps the log well inside localStorage. */
export const MAX_LINES = 3000;
/** Per request up — the server's maxItems. */
export const BATCH = 500;
/** How long "…" may stand before it is written down. */
export const STUCK_MS = 5000;

// ── pure: the log as a list ───────────────────────────────────────────

/** The log without lines older than a week or beyond the cap, newest kept. Pure. */
export function trimmed(lines, now, { keepMs = KEEP_MS, max = MAX_LINES } = {}) {
  const fresh = (lines ?? []).filter((l) => now - l.t < keepMs);
  return fresh.length > max ? fresh.slice(fresh.length - max) : fresh;
}

/** The lines not yet sent, oldest first, at most `batch`. Pure. */
export function unsent(lines, sentSeq, batch = BATCH) {
  return (lines ?? []).filter((l) => l.s > (sentSeq ?? 0)).slice(0, batch);
}

/**
 * A path for the log: no query string, except the deck a request was about.
 * `/browse?q=…` carries what she searched for, and that is not ours. Pure.
 */
export function logPath(path) {
  const [base, search = ""] = String(path).split("?");
  const deck = new URLSearchParams(search).get("deckKey");
  return deck ? `${base}?deckKey=${deck}` : base;
}

/** One line of the log, the way Diagnose shows it. Pure. */
export function describe(line) {
  const clock = new Date(line.t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const d = line.d ?? {};
  const rest = Object.entries(d)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  return `${clock} ${line.k}${rest ? " " + rest : ""}`;
}

// ── the device's copy ─────────────────────────────────────────────────

const storage = () => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

function read(key, fallback) {
  try {
    const raw = storage()?.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or refused: the lines stay in memory for this run, which is still
    // what Diagnose shows and what goes up next.
  }
}

let lines;
let seq;
let dirty;

function load() {
  if (lines) return;
  lines = trimmed(read(LOG, []), Date.now());
  seq = lines.length ? lines[lines.length - 1].s : read(SENT, 0);
}

function persist() {
  dirty = undefined;
  if (lines) write(LOG, lines);
}

/** This device, as the server tells devices apart. Made once, kept. */
export function deviceId() {
  let id = read(DEVICE, undefined);
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    write(DEVICE, id);
  }
  return id;
}

/**
 * Write a line. Never throws and never waits: the recorder must not be able
 * to break, or slow, what it is recording.
 */
export function note(kind, data) {
  try {
    load();
    seq += 1;
    const line = { s: seq, t: Date.now(), k: kind };
    if (data && Object.keys(data).length) line.d = data;
    lines.push(line);
    if (lines.length > MAX_LINES + 100) lines = trimmed(lines, Date.now());
    // Written a moment later, not on every line: a burst of requests at a
    // start is one write, not twenty. `hidden` writes at once (below), since
    // iOS may end the app without another chance.
    dirty ??= setTimeout(persist, 1000);
  } catch {
    /* never */
  }
}

/** The newest lines, newest last, for Diagnose. */
export function recent(n = 20) {
  load();
  return lines.slice(-n);
}

/** How many times this week something stood on "…" (for the Diagnose row). */
export function stuckCount() {
  load();
  return lines.filter((l) => l.k === "stuck").length;
}

/** How many lines the server has not had yet. */
export function unsentCount() {
  load();
  const sent = read(SENT, 0);
  return lines.filter((l) => l.s > sent).length;
}

// ── sending ──────────────────────────────────────────────────────────

let sending;

/**
 * Send what the server has not had, in batches. Called after the reviews and
 * the ui moments have had their turn, never ahead of them. `post` is
 * `api.deviceLog`, passed in so this module has no import of api.js — api.js
 * imports this one, to note its requests.
 */
export function flushTrace(post) {
  sending ??= (async () => {
    load();
    for (let round = 0; round < 10; round++) {
      const batch = unsent(lines, read(SENT, 0));
      if (batch.length === 0) return;
      await post(deviceId(), batch);
      write(SENT, batch[batch.length - 1].s);
    }
  })()
    .catch(() => {
      // Offline, or refused: they go up next time. A week's cap means a
      // refusal cannot make the log grow for ever.
    })
    .finally(() => {
      sending = undefined;
    });
  return sending;
}

// ── requests in flight, for the watchdog ─────────────────────────────

const open = new Map();
let openId = 0;

/** Called by api.js around each request. Returns the function that ends it. */
export function requestStarted(path) {
  const id = ++openId;
  const started = Date.now();
  const p = logPath(path);
  open.set(id, { p, started });
  return (result) => {
    open.delete(id);
    note("req", { p, ms: Date.now() - started, r: result });
  };
}

function openRequests(now) {
  return [...open.values()].map((r) => `${r.p} ${Math.round((now - r.started) / 100) / 10}s`);
}

// ── the watchdog ─────────────────────────────────────────────────────

/**
 * Whether the screen is waiting: a "…" placeholder is up. The app draws one
 * shape of it for every screen (`div.loading`, "Wird geprüft …"), so this
 * finds a wait on a screen nobody thought to instrument — which is the case
 * it exists for.
 */
function waitingOn(root) {
  if (!root) return undefined;
  const loading = root.querySelector(".loading, .deck-today-state");
  if (loading && /…/.test(loading.textContent ?? "")) return loading.className;
  return undefined;
}

/**
 * Start the recorder: the start itself, returns to the app, network events,
 * errors, and the watchdog. `where` says which screen is up, in a word or
 * two, from the shell's own state.
 */
export function startTrace({ version, where, root }) {
  if (typeof window === "undefined") return;
  note("start", {
    v: version,
    online: navigator.onLine,
    standalone: matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true,
    sw: !!navigator.serviceWorker?.controller,
  });

  addEventListener("online", () => note("online"));
  addEventListener("offline", () => note("offline"));
  addEventListener("pageshow", (e) => e.persisted && note("pageshow"));
  document.addEventListener("visibilitychange", () => {
    note(document.visibilityState === "visible" ? "shown" : "hidden", { online: navigator.onLine });
    if (document.visibilityState === "hidden") persist();
  });
  addEventListener("pagehide", persist);
  addEventListener("error", (e) =>
    note("error", { m: String(e.message ?? "").slice(0, 200), at: `${String(e.filename ?? "").split("/").pop()}:${e.lineno ?? ""}` }),
  );
  addEventListener("unhandledrejection", (e) =>
    note("rejection", { m: String(e.reason?.message ?? e.reason ?? "").slice(0, 200) }),
  );

  // Every second, while on screen: which screen, and whether it waits.
  let lastWhere;
  let since;
  let reported = 0;
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    const w = safe(where);
    if (w !== lastWhere) {
      note("screen", { w });
      lastWhere = w;
    }
    const what = waitingOn(root);
    if (!what) {
      if (since && reported) note("unstuck", { w, ms: now - since });
      since = undefined;
      reported = 0;
      return;
    }
    since ??= now;
    // Once at 5 s, and again at 30 s and 2 min if it is still there, each
    // with what is still open — so a wait that never ends says so.
    const marks = [STUCK_MS, 30000, 120000];
    if (reported < marks.length && now - since >= marks[reported]) {
      note("stuck", { w, ms: now - since, el: what, open: openRequests(now), online: navigator.onLine });
      reported += 1;
    }
  }, 1000);
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return "?";
  }
}
