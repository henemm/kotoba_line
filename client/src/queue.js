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
import { note } from "./trace.js";
import { answeredOnDevice, getMeta, outbox, setMeta } from "./store.js";

const key = (opts) => `queue${query(opts)}`;

/**
 * The same cards in any way of practising (#304): the filters without the
 * mode or a limit, in a fixed order so two callers that spread them
 * differently still meet.
 *
 * The exact key above is kept only for a session started online in that very
 * way, in that very deck. Henning, 2026-09-26, offline in a deck he had opened
 * online but not practised in: "Du bist offline, und diese Auswahl wurde noch
 * nie online geübt" in every deck and every way — his flight recorder showed
 * the deck pages loaded online, and no session. The server's queue differs
 * between ways only in leaving out reversed cards outside めくる (#284), which
 * `playableIn` does on the device too; so any queue for the deck will do.
 */
const anyWayKey = (opts) => {
  const { mode, limit, ...rest } = opts ?? {};
  return `queue.any${query(Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))))}`;
};

/** What is kept of an answer, for either key. */
function kept(answer) {
  return {
    cardIds: answer.cardIds,
    // The intervals are cached with the queue on purpose: めくる prints them
    // under every button, and a session on a train would otherwise show four
    // blanks where the reason for four buttons should be.
    intervals: answer.intervals,
    // What the buttons say after a Nochmal (#242), for the same reason.
    againIntervals: answer.againIntervals,
    // And after Schwer or Gut on the first showing (#242).
    stepIntervals: answer.stepIntervals,
    // Tomorrow's, and when each day ends (#246): a queue cached today can
    // be run on tomorrow's train, when the intervals have grown a day.
    intervalsTomorrow: answer.intervalsTomorrow,
    labelDays: answer.labelDays,
    // Cached for the same reason as the intervals: the session draws a star
    // on every card (#35), and a session on a train would otherwise draw all
    // of them empty — which reads as "nothing is starred", not as "unknown".
    starred: answer.starred,
    // Her own and a native speaker's recordings (#183 follow-up) — same
    // reasoning as starred: known offline, not "none" until the next sync.
    recordings: answer.recordings,
    at: Date.now(),
  };
}

/**
 * Keep a queue the app was given anyway (#304) — the deck page's count, the
 * "Nächste Karten laden" button's — for any way of practising offline. It
 * costs no request: those answers were already on the device and dropped.
 */
export function keepForAnyWay(opts, answer) {
  return setMeta(anyWayKey(opts), kept(answer)).catch(() => {});
}

/** The exact queue, or the deck's in any way — whichever is newer. */
async function cachedFor(opts) {
  const [exact, any] = await Promise.all([getMeta(key(opts)), getMeta(anyWayKey(opts))]);
  if (!exact) return any;
  if (!any) return exact;
  return (any.at ?? 0) > (exact.at ?? 0) ? any : exact;
}

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
    const entry = kept(answer);
    await Promise.all([setMeta(key(opts), entry), setMeta(anyWayKey(opts), entry)]);
    return answer;
  });
  // Read alongside the request rather than after it, so a slow server costs
  // the wait and not the wait plus a disk read.
  const reading = cachedFor(opts);

  let outcome = await answerSoon(asking);
  if (!outcome) {
    const cached = await reading;
    // #299: a session started from the device's copy, not the server's.
    note("queue", { from: cached ? "device" : "waiting", deck: opts?.deckKey });
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
      againIntervals: answer.againIntervals,
      stepIntervals: answer.stepIntervals,
      intervalsTomorrow: answer.intervalsTomorrow,
      labelDays: answer.labelDays,
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
    againIntervals: cached.againIntervals,
    stepIntervals: cached.stepIntervals,
    intervalsTomorrow: cached.intervalsTomorrow,
    labelDays: cached.labelDays,
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
