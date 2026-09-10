/**
 * What to practise, when the server cannot be asked.
 *
 * The queue is computed on the server (§5) because that is where `card_state`
 * lives and where the daily new-card limit is enforced. Offline the client
 * cannot recompute it — but it does not have to. The last answer for the same
 * options is kept, and a session on a train runs the cards that were due when
 * the phone last had a connection.
 *
 * That is honest rather than clever: it is genuinely the right set of cards,
 * just as of a few hours ago. What it must not do is offer the same card twice
 * because the first answer has not reached the server yet — so anything
 * already sitting in the outbox is removed.
 */
import { OfflineError, api, query } from "./api.js";
import { getMeta, setMeta } from "./store.js";
import { outbox } from "./store.js";

const key = (opts) => `queue${query(opts)}`;

/**
 * The card ids for a session, and where they came from.
 *
 * `stale` is true when they are the cached set, so the session can say so
 * rather than pretending the count is today's.
 */
export async function sessionQueue(opts) {
  try {
    const answer = await api.queue(opts);
    // The intervals are cached with the queue on purpose: めくる prints them
    // under every button, and a session on a train would otherwise show four
    // blanks where the reason for four buttons should be.
    await setMeta(key(opts), {
      cardIds: answer.cardIds,
      intervals: answer.intervals,
      at: Date.now(),
    });
    return { cardIds: answer.cardIds, intervals: answer.intervals, stale: false };
  } catch (err) {
    if (!(err instanceof OfflineError)) throw err;

    const cached = await getMeta(key(opts));
    if (!cached) return { cardIds: [], stale: true, never: true };

    const answered = new Set((await outbox()).map((e) => e.card_id));
    return {
      cardIds: cached.cardIds.filter((id) => !answered.has(id)),
      intervals: cached.intervals,
      stale: true,
      at: cached.at,
    };
  }
}
