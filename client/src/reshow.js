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
 * Its own module rather than a line inside session.js so that the
 * simulation (server/test/simulate-days.js) runs the very rule the app runs.
 * A copy there would keep passing after this one changed.
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
