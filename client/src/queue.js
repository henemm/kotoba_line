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
 * because the answer to it is newer than the cached queue — so anything
 * answered on this device since the queue was cached is removed, whether it
 * is still in the outbox or has already been sent.
 */
import { OfflineError, answerSoon, api, isSessionExpired, query } from "./api.js";
import { answeredOnDevice, getMeta, outbox, setMeta } from "./store.js";

const key = (opts) => `queue${query(opts)}`;

/**
 * The card ids for a session, and where they came from.
 *
 * `stale` is true when they are the cached set, so the session can say so
 * rather than pretending the count is today's.
 *
 * #106: the server is asked first, but not waited out. When it has not
 * answered within `PATIENCE_MS` and this device holds a queue for the same
 * options, that queue runs — on a stalled connection the answer would
 * otherwise only arrive as a timeout, ten seconds later. The request goes on
 * regardless, and a late answer still refreshes the cache for the next
 * session. It is never swapped into this one: a queue that changed under her
 * after the first card would be a different session under the same name.
 */
export async function sessionQueue(opts) {
  const asking = api.queue(opts).then(async (answer) => {
    // The intervals are cached with the queue on purpose: めくる prints them
    // under every button, and a session on a train would otherwise show four
    // blanks where the reason for four buttons should be.
    await setMeta(key(opts), {
      cardIds: answer.cardIds,
      intervals: answer.intervals,
      // Cached for the same reason as the intervals: the session draws a star
      // on every card (#35), and a session on a train would otherwise draw all
      // of them empty — which reads as "nothing is starred", not as "unknown".
      starred: answer.starred,
      // Her own and a native speaker's recordings (#183 follow-up) — same
      // reasoning as starred: known offline, not "none" until the next sync.
      recordings: answer.recordings,
      at: Date.now(),
    });
    return answer;
  });
  // Read alongside the request rather than after it, so a slow server costs
  // the wait and not the wait plus a disk read.
  const reading = getMeta(key(opts));

  let outcome = await answerSoon(asking);
  if (!outcome) {
    const cached = await reading;
    if (cached) return fromCache(cached);
    // Nothing on the device to go on with, so the only answer is the server's.
    outcome = await asking.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
  }

  if (outcome.value) {
    const answer = outcome.value;
    return {
      cardIds: answer.cardIds,
      intervals: answer.intervals,
      starred: answer.starred ?? [],
      recordings: answer.recordings ?? [],
      stale: false,
    };
  }

  // An expired cookie (52) falls back the same way no connection does: the
  // server cannot answer either way, and the screen that asks her to sign in
  // again promises "practising works offline in the meantime". Without this
  // that sentence was untrue — tapping a line went nowhere until she signed
  // in, which is the one thing she should not have to do on a train.
  const err = outcome.error;
  if (!(err instanceof OfflineError) && !isSessionExpired(err)) throw err;

  const cached = await reading;
  if (!cached) return { cardIds: [], stale: true, never: true };
  return fromCache(cached);
}

async function fromCache(cached) {
  const [waiting, answered] = await Promise.all([outbox(), answeredOnDevice()]);
  return {
    cardIds: stillToAnswer(cached, waiting, answered),
    intervals: cached.intervals,
    starred: cached.starred ?? [],
    recordings: cached.recordings ?? [],
    stale: true,
    at: cached.at,
  };
}

/**
 * The cached queue's cards that have not been answered since it was cached.
 *
 * Anything still in the outbox goes, as it always did: the server had not
 * heard of that answer when it built the queue. So does anything answered
 * after the queue was cached, sent or not. An older answer that had already
 * been sent is not a reason to drop the card — the server knew about it and
 * put the card there anyway.
 */
export function stillToAnswer(cached, waiting = [], answered = {}) {
  const since = Math.floor((cached.at ?? 0) / 1000);
  const inOutbox = new Set(waiting.map((e) => e.card_id));
  return cached.cardIds.filter((id) => !inOutbox.has(id) && !((answered[id] ?? -1) >= since));
}
