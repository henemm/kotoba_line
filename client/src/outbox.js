/**
 * The outbox (§4).
 *
 * An answered card is written here *before* it is sent, and removed only when
 * the server has acknowledged it by id. That order is the whole point: a
 * session on a train, an app killed by iOS, a flush that dies halfway — none
 * of them can lose a review, because the review was on disk first.
 *
 * Retrying blindly is safe. `POST /api/events` is `INSERT OR IGNORE` on the
 * client-generated UUID, so re-sending an event the server already has costs
 * one row lookup and changes nothing.
 */
import { ApiError, OfflineError, api } from "./api.js";
import { flushSeen } from "./seen.js";
import { flushTrace, note } from "./trace.js";
import { acknowledge, enqueue, noteAnswered, outbox, outboxCount } from "./store.js";

const listeners = new Set();

/**
 * Called with `{ waiting, sent }` whenever the outbox changes.
 *
 * `sent` is how many went up in the flush that just finished, and it is what
 * design 25's green bar states — "Synced · 14 reviews sent". It is not the
 * same number as `waiting`, and showing one where the other belongs is the
 * obvious way to get this wrong.
 *
 * `status` is present only when a flush was refused, and carries the HTTP
 * status that refused it — 401 is design 52.
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function announce(sent = 0, extra = {}) {
  const waiting = await outboxCount();
  for (const fn of listeners) fn({ waiting, sent, ...extra });
  return waiting;
}

export async function pending() {
  return outboxCount();
}

/** Record answers. Returns once they are durable, before any network call. */
export async function record(events) {
  if (events.length === 0) return;
  await enqueue(events);
  // After the outbox, which is the write that must not be lost; this one only
  // keeps a cached queue from offering the card again (#106, queue.js).
  await noteAnswered(events);
  await announce();
}

let flushing;

/**
 * Send everything waiting.
 *
 * Serialised: two flushes at once would both post the same events, which is
 * harmless server-side but would double-count the "sent" figure the offline
 * strip shows. Returns what happened, so a caller can tell "nothing to send"
 * from "could not send".
 */
export function flush() {
  flushing ??= doFlush()
    .then((result) => {
      // Here, not in startFlushing(): the flush at the end of a session is a
      // direct call, and that is the one that fails on a train (#299 found
      // it — v168 retried only the flushes startFlushing() had fired).
      retryIfStuck(result);
      // #299: every attempt that had something to send, since "24 warten"
      // with no trace of a try is exactly what could not be explained.
      if (result.remaining || result.sent) note("flush", result);
      return result;
    })
    .finally(() => {
      flushing = undefined;
    });
  return flushing;
}

async function doFlush() {
  const events = await outbox();
  if (events.length === 0) return { sent: 0, remaining: 0 };

  // The server takes the wire shape, not our stored one.
  const payload = events.map(({ id, card_id, mode, rating, reviewed_at }) => ({
    id,
    card_id,
    mode,
    rating,
    reviewed_at,
  }));

  try {
    await api.events(payload);
  } catch (err) {
    if (err instanceof OfflineError) {
      return { sent: 0, remaining: events.length, offline: true };
    }
    // 401 means the session expired: the events stay put and go up after the
    // next sign-in. Anything else is the server refusing, and dropping the
    // events on that would lose them for good.
    if (err instanceof ApiError) {
      // Announced, not just returned: design 52's screen comes back "when the
      // outbox next tries to flush", and most flushes are the background ones
      // startFlushing() fires — nobody is looking at their return value.
      await announce(0, { status: err.status });
      return { sent: 0, remaining: events.length, status: err.status };
    }
    throw err;
  }

  await acknowledge(events.map((e) => e.id));
  const remaining = await announce(events.length);
  return { sent: events.length, remaining };
}

/**
 * Flush now, and again whenever the device comes back.
 *
 * §7: storage can be evicted under pressure, which is exactly why this flushes
 * eagerly rather than batching for hours.
 */
/**
 * What design 25's strip should say, as a value rather than as DOM — so it can
 * be tested, and because the one mistake this strip can make is arithmetic:
 * the number beside "sent" is not the number beside "waiting".
 *
 * Returns null for the state she is in almost always: online, nothing queued,
 * no bar.
 */
export function offlineStatus({ online, waiting = 0, justSent = 0, signedOut = false }) {
  const reviews = (n) => `${n} ${n === 1 ? "Wiederholung" : "Wiederholungen"}`;
  const wait = (n) => (n === 1 ? "wartet" : "warten");

  if (!online) {
    return { tone: "offline", text: waiting > 0 ? `Offline · ${reviews(waiting)} ${wait(waiting)}` : "Offline" };
  }
  // 52, and it is checked after `online` on purpose: with no connection she
  // cannot sign in either, and "Offline" is the state she can act on. The
  // number here is what is *waiting*, never what was last sent — the whole
  // point of the bar at this moment is that nothing has gone up.
  if (signedOut) {
    return {
      tone: "offline",
      text: waiting > 0 ? `Abgemeldet · ${reviews(waiting)} ${wait(waiting)}` : "Abgemeldet",
    };
  }
  if (justSent > 0) {
    return { tone: "synced", text: `Synchronisiert · ${reviews(justSent)} gesendet` };
  }
  // Online with events still queued: the flush has not run, or the server
  // refused them. Claiming "offline" would be untrue and saying nothing would
  // hide a stuck outbox.
  if (waiting > 0) {
    return { tone: "offline", text: `${reviews(waiting)} ${wait(waiting)} aufs Senden` };
  }
  return null;
}

let flushingStarted = false;

/**
 * #297: on a weak signal a flush gives up after REQUEST_TIMEOUT_MS, and
 * nothing asked again while the app stayed open — thin WLAN that recovers
 * fires no "online" event, since the device never counted as offline. Her
 * reviews sat under "24 Wiederholungen warten aufs Senden" until she left the
 * app or ended a session (measured in WebKit: still 3 waiting 45 s after the
 * API came back). So an attempt that could not reach the server is tried
 * again after RETRY_MS, while the app is on screen. One small request, and
 * only while something is waiting. A refused flush (401) is not retried: it
 * needs her to sign in, not a timer.
 */
const RETRY_MS = 30 * 1000;
let retry;

function retryIfStuck(result) {
  if (!result?.offline || retry) return;
  retry = setTimeout(() => {
    retry = undefined;
    if (document.visibilityState === "visible") startFlushing();
  }, RETRY_MS);
}

export function startFlushing() {
  // #228: what she was shown goes up on the same occasions, never ahead of
  // her reviews and never counted with them.
  const attempt = () =>
    flush()
      .catch(() => {})
      .then(() => flushSeen().catch(() => {}))
      // #299: the flight recorder last, behind her reviews and the moments.
      .then(() => flushTrace((device, lines) => api.deviceLog(device, lines)));
  if (flushingStarted) return attempt();
  flushingStarted = true;

  addEventListener("online", attempt);
  // Coming back to the app is as good a signal as a network event, and on iOS
  // it is often the only one that arrives.
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") attempt();
  });
  attempt();
}
