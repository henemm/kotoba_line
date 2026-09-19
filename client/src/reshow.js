/**
 * #214: a card she rates Nochmal goes to the end of the session's queue and
 * comes round again, at most `MAX_RESHOWS` times — what the "1 Min" under the
 * button already means, and what Noji does. After that it is due again in a
 * minute anyway, and the next session brings it.
 *
 * Its own module rather than a line inside session.js so that the multi-day
 * simulation (server/test/simulate-days.js, #242) runs the very rule the app
 * runs. A copy there would keep passing after this one changed.
 */
export const MAX_RESHOWS = 3;

const RATING_AGAIN = 1;

/** Whether this answer sends the card round again, given how often it already has. */
export function comesRoundAgain(rating, timesSoFar = 0) {
  return rating === RATING_AGAIN && timesSoFar < MAX_RESHOWS;
}
