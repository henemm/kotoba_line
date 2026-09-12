/**
 * Star sync (#22).
 *
 * A star is a small piece of state, not a trajectory: unlike a review, there
 * is nothing to compute from a history of every tap, only "is it starred, as
 * of when". So it does not need `review_events`' append-only log — a single
 * queued intention per card, carrying when it was decided, is enough. The
 * server applies the same rule §4 states for reviews: trust the time the
 * action happened, never the order it arrived in, so two offline devices
 * touching the same card resolve the same way regardless of which syncs
 * first (see `setStar` in `server/src/queue.js`).
 *
 * This is deliberately a second, smaller mechanism rather than a second kind
 * of entry in `outbox.js`: that module's wire shape, wording ("N reviews
 * waiting") and retry rules are all specific to a review, and a star does not
 * share its most important property — an answer must never be lost, while a
 * star that never reaches the server is just a star she taps again.
 */
import { ApiError, OfflineError, api } from "./api.js";
import { pendingStars, queueStar, unqueueStars } from "./store.js";

/**
 * Set a star, online or off. Queues first — durable before it is sent, same
 * reasoning as the outbox — then tries to deliver right away, so a tap made
 * with a connection does not sit there for no reason.
 *
 * Never throws: a caller draws the tap optimistically and does not need to
 * undo it if this turns out to be offline, because offline is not a failure
 * here, it is the queue doing its job.
 */
export async function setStar(cardId, starred) {
  const changedAt = Math.floor(Date.now() / 1000);
  await queueStar({ card_id: cardId, starred, changed_at: changedAt });
  await flushStars();
}

let flushing;

/** Send every pending star. Serialised, same reason as the outbox's flush. */
export function flushStars() {
  flushing ??= doFlushStars().finally(() => {
    flushing = undefined;
  });
  return flushing;
}

async function doFlushStars() {
  const entries = await pendingStars();
  if (entries.length === 0) return { sent: 0, remaining: 0 };

  const done = [];
  for (const entry of entries) {
    try {
      await api.star(entry.card_id, entry.starred, entry.changed_at);
      done.push(entry.card_id);
    } catch (err) {
      if (err instanceof OfflineError) break; // still offline — stop, leave the rest queued
      // A 401 means the session expired, not that this star was refused: it
      // stays queued and goes up after the next sign-in, same as the outbox
      // treats it. Anything else the server actually rejected (an unknown
      // card, say) will not succeed on a retry either, so it is dropped
      // rather than retried silently forever.
      if (!(err instanceof ApiError && err.status === 401)) done.push(entry.card_id);
    }
  }
  if (done.length > 0) await unqueueStars(done);
  return { sent: done.length };
}

let flushingStarted = false;

/** Flush now, and again whenever the device comes back — same as the outbox. */
export function startFlushingStars() {
  const attempt = () => flushStars().catch(() => {});
  if (flushingStarted) return attempt();
  flushingStarted = true;

  addEventListener("online", attempt);
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") attempt();
  });
  attempt();
}
