/**
 * An unfinished session, kept so she can come back to it (design 51).
 *
 * Her *answers* already survive an interruption — they go into the outbox as
 * she gives them (§4). What did not survive was the session: the queue, where
 * she was in it, and which set it was. Being interrupted is the normal way a
 * session on a train ends, so starting over was the common case, not the rare
 * one.
 *
 * This is a note about a session, not a source of truth. It holds card ids and
 * a position; the answers are elsewhere and the scheduler is on the server. If
 * it is ever wrong, the worst outcome is a few cards offered again — which is
 * exactly what would have happened without it.
 */
import { getMeta, setMeta } from "./store.js";

const KEY = "session.open";

/** 51: "four hours or at the day boundary, whichever comes first". */
export const RESUME_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * The day a moment falls on, on this device's clock — the same day the server
 * counts the streak and the new cards in, because api.js sends it this
 * device's time zone (#122). So a session and the day it counts towards
 * cannot disagree. `timeZone` is for the tests; the app leaves it out.
 */
export function localDay(ms, timeZone = undefined) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms),
  );
}

/**
 * Whether a saved session is still worth offering.
 *
 * Past either edge the remaining cards are simply due again and the row is
 * gone: a queue built yesterday is a queue the scheduler has since revised.
 */
export function isResumable(saved, now = Date.now(), timeZone = undefined) {
  if (!saved?.cardIds?.length) return false;
  if (saved.index >= saved.cardIds.length) return false;
  if (now - saved.at > RESUME_WINDOW_MS) return false;
  return localDay(saved.at, timeZone) === localDay(now, timeZone);
}

/** "4 of 20 done, 20 minutes ago" — 51's second line. */
export function describe(saved, now = Date.now()) {
  // Floored, not rounded: thirty seconds ago is "just now", not "1 minute
  // ago". Rounding up makes the app sound like it was away longer than it was.
  const minutes = Math.floor((now - saved.at) / 60000);
  const when =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes} minute${minutes === 1 ? "" : "s"} ago`
        : `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"} ago`;
  return `${saved.index} of ${saved.cardIds.length} done, ${when}`;
}

export async function remember(session) {
  return setMeta(KEY, { ...session, at: Date.now() });
}

export async function forget() {
  return setMeta(KEY, undefined);
}

/** The saved session if it is still offerable, otherwise nothing. */
export async function openSession(now = Date.now()) {
  const saved = await getMeta(KEY);
  if (!isResumable(saved, now)) {
    if (saved) await forget();
    return undefined;
  }
  return saved;
}
