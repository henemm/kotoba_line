/**
 * #214: a card she rates Nochmal comes round again in the same session, at
 * most `MAX_RESHOWS` times — what the "1 Min" under the button means, and
 * what Noji does ("the card will be shown for you in 1 minute in the same
 * study session again", help.noji.io, checked 2026-09-19).
 *
 * #242: after `RESHOW_AFTER` other cards, not at the end of the session. At
 * the end, a session she leaves early never reached it: the multi-day
 * simulation measured a Nochmal card back in the same session 7 % of the
 * time for twenty-card sessions on the train, and 100 % only for someone who
 * always finishes all sixty. Three cards is about a minute in every mode.
 *
 * #242 too: Schwer and Gut on a card still in its learning steps (8 and 15
 * minutes since v140, Noji's numbers) bring it back in the same session once
 * those minutes have passed, if the session is still going — Anki's and
 * Noji's way. Before, only Nochmal did, and "15 Min" under Gut meant "next
 * time you open the app", measured as 11 hours for two sessions a day.
 *
 * Its own module rather than lines inside session.js so that the
 * simulation (server/test/simulate-days.js) runs the very rules the app runs.
 * A copy there would keep passing after these changed.
 */
export const MAX_RESHOWS = 3;
export const RESHOW_AFTER = 3;

const RATING_AGAIN = 1;

/** Whether this answer sends the card round again, given how often it already has. */
export function comesRoundAgain(rating, timesSoFar = 0) {
  return rating === RATING_AGAIN && timesSoFar < MAX_RESHOWS;
}

/**
 * Where in the queue the card goes: `RESHOW_AFTER` cards after the one just
 * answered at `index`, or the end when fewer are left.
 */
export function reshowPosition(index, length) {
  return Math.min(index + 1 + RESHOW_AFTER, length);
}

/** Shorter than this, an interval is a learning step: minutes, not days. */
export const LEARNING_STEP_LIMIT = 86400;

/**
 * Seconds after which this answer brings the card back within the session,
 * given the interval the button showed — or undefined: Nochmal goes by
 * position (`reshowPosition`), and a day or more is a later session's.
 */
// Bounded only through the labels: a card comes back after Schwer or Gut
// only while `labelsAfter` still knows its intervals, which it does for one
// such return — after that `seconds` is undefined. Make the labels reach
// further and this needs a limit of its own, or a card that keeps getting
// Schwer keeps a session from ending.
export function returnsAfter(rating, seconds) {
  if (rating === RATING_AGAIN || seconds == null) return undefined;
  return seconds < LEARNING_STEP_LIMIT ? seconds : undefined;
}

/**
 * The waiting card whose time has come first, taken out of `waiting`
 * (`{ at, ... }` entries, `at` in unix seconds) — or undefined.
 */
export function takeDue(waiting, now) {
  let best = -1;
  for (let i = 0; i < waiting.length; i++) {
    if (waiting[i].at <= now && (best < 0 || waiting[i].at < waiting[best].at)) best = i;
  }
  return best < 0 ? undefined : waiting.splice(best, 1)[0];
}

/**
 * Which labels the server sent hold for the card's next showing, given the
 * ones that held for this one: "first" before any answer; "again" after
 * Nochmal — the server works out ahead what the buttons say after one, two
 * and three in a row (`againIntervals`, picked by how often the card has come
 * round); "step:2" or "step:3" after Schwer or Gut on the first showing
 * (`stepIntervals`); undefined after anything else, which no session-start
 * number describes.
 */
export function labelsAfter(rating, current) {
  // Only a run of Nochmal from the first showing: after Schwer then Nochmal
  // the card is not where one Nochmal from the start would put it (measured
  // in the simulation: Leicht said 1 Tag, scheduled 3).
  if (rating === RATING_AGAIN) return current === "first" || current === "again" ? "again" : undefined;
  if (current === "first" && (rating === 2 || rating === 3)) return `step:${rating}`;
  return undefined;
}

/**
 * #246: the four intervals the buttons print for this showing of a card, in
 * seconds — or undefined when none the server sent still holds.
 *
 * `sets` is what the queue brought (server/src/routes/deck.js): the
 * intervals for a first showing today and tomorrow, those after Nochmal and
 * after a learning step, and `labelDays`, the moments today and tomorrow end
 * on the device's calendar. A card's intervals grow with the days since she
 * last saw it, so an answer after midnight gets a longer one than the same
 * answer before it: a session that runs past midnight, or a queue cached for
 * the train yesterday, would print a day too few.
 *
 * Past the first midnight only a first showing has a number: the ones after
 * Nochmal or a step were worked out for today, and "no number beats a wrong
 * one" (#214). Past the second, nothing. A queue cached before v142 has no
 * `labelDays` and keeps today's, as it always did.
 */
export function labelsAt(sets, cardId, source, timesAgain, nowSeconds) {
  const ends = sets.labelDays;
  const day = !ends ? 0 : nowSeconds < ends[0] ? 0 : nowSeconds < ends[1] ? 1 : 2;
  if (day === 1) return source === "first" ? sets.intervalsTomorrow?.[cardId] : undefined;
  if (day > 1) return undefined;
  if (source === "first") return sets.intervals?.[cardId];
  // One set per Nochmal in a row.
  if (source === "again") return sets.againIntervals?.[cardId]?.[(timesAgain ?? 1) - 1];
  if (source?.startsWith("step:")) return sets.stepIntervals?.[cardId]?.[source.slice(5)];
  return undefined;
}
