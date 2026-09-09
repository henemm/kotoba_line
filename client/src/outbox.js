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
import { acknowledge, enqueue, outbox, outboxCount } from "./store.js";

const listeners = new Set();

/**
 * Called with `{ waiting, sent }` whenever the outbox changes.
 *
 * `sent` is how many went up in the flush that just finished, and it is what
 * design 25's green bar states — "Synced · 14 reviews sent". It is not the
 * same number as `waiting`, and showing one where the other belongs is the
 * obvious way to get this wrong.
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function announce(sent = 0) {
  const waiting = await outboxCount();
  for (const fn of listeners) fn({ waiting, sent });
  return waiting;
}

export async function pending() {
  return outboxCount();
}

/** Record answers. Returns once they are durable, before any network call. */
export async function record(events) {
  if (events.length === 0) return;
  await enqueue(events);
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
  flushing ??= doFlush().finally(() => {
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
export function offlineStatus({ online, waiting = 0, justSent = 0 }) {
  const reviews = (n) => `${n} review${n === 1 ? "" : "s"}`;

  if (!online) {
    return { tone: "offline", text: waiting > 0 ? `Offline · ${reviews(waiting)} waiting` : "Offline" };
  }
  if (justSent > 0) {
    return { tone: "synced", text: `Synced · ${reviews(justSent)} sent` };
  }
  // Online with events still queued: the flush has not run, or the server
  // refused them. Claiming "offline" would be untrue and saying nothing would
  // hide a stuck outbox.
  if (waiting > 0) {
    return { tone: "offline", text: `${reviews(waiting)} waiting to send` };
  }
  return null;
}

let flushingStarted = false;

export function startFlushing() {
  const attempt = () => flush().catch(() => {});
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
