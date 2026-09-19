import { createEmptyCard, fsrs, generatorParameters, Rating } from "ts-fsrs";

/**
 * FSRS scheduling (§6).
 *
 * `enable_fuzz` is off deliberately. Fuzz randomises each interval by a few
 * percent so that cards introduced together do not come back together — useful,
 * but it makes scheduling non-deterministic. §3 promises that card_state can be
 * deleted and rebuilt from review_events at any time, and that promise is only
 * worth anything if the rebuild lands on the same answer every time. A replay
 * that quietly moves every due date is not a rebuild.
 */
/**
 * Noji's intervals (#242, Henning 2026-09-19: "Mache es so wie Noji"). Noji
 * documents a new card as Nochmal 1 minute in the same session, Schwer 8
 * minutes, Gut 15 minutes, Leicht 4 days (help.noji.io, "Personalise your
 * Learning Algorithm", checked 2026-09-19). ts-fsrs's defaults gave 1, 6, 10
 * minutes and 8 days, and a forgotten card 10 minutes for Nochmal.
 *
 * - `learning_steps` 1m, 15m: Nochmal is the first step, Gut the second,
 *   Schwer the average of the two (8 minutes) — ts-fsrs's own rule.
 * - `relearning_steps` the same, so Nochmal on a card she knew is also 1
 *   minute, as Noji says of Nochmal on any card.
 * - `w[3]`, the initial stability for Leicht, 8.2956 → 4: Leicht on a new card
 *   is 4 days. Nothing else in the default weights is touched.
 *
 * Everything past the learning steps is still FSRS with default weights; Noji
 * does not document what it does there. Changing any of this changes every
 * replayed state (§3): deploying it needs a `replayCardState` over everyone.
 */
const weights = [...generatorParameters().w];
weights[3] = 4;
const engine = fsrs(
  generatorParameters({
    enable_fuzz: false,
    learning_steps: ["1m", "15m"],
    relearning_steps: ["1m", "15m"],
    w: weights,
  }),
);

const RATINGS = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

export const VALID_RATINGS = Object.keys(RATINGS).map(Number);
// "type" is 書く (#97). An event's mode is a label for the log — the scheduler
// folds every mode's ratings into one state (§6) and never reads it — but an
// event with a mode missing here is refused at the schema, so a client with
// a new mode must never reach a server without it.
export const VALID_MODES = ["choose", "listen", "speak", "type", "flip"];

/**
 * Order events the way the scheduler must see them.
 *
 * By reviewed_at, then by id. The tiebreak matters: two devices can stamp the
 * same second, and without it the replayed order — and so the final state —
 * would depend on the order rows happened to come back from SQLite.
 */
export function orderEvents(events) {
  return [...events].sort(
    (a, b) => a.reviewed_at - b.reviewed_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Fold one card's whole event history into its scheduler state.
 *
 * Always a full fold, never an incremental update from the previous state.
 * Two devices append to one log (§4) and an event can arrive after a later one
 * has already been processed; folding from the start makes the result depend
 * only on the set of events, not on the order they were received in. That is
 * what makes the same batch posted three times land on identical state.
 */
export function stateFromEvents(events) {
  const ordered = orderEvents(events);
  if (ordered.length === 0) return undefined;

  let card = createEmptyCard(new Date(ordered[0].reviewed_at * 1000));

  for (const e of ordered) {
    const rating = RATINGS[e.rating];
    if (!rating) throw new Error(`unknown rating ${e.rating} on event ${e.id}`);
    card = engine.next(card, new Date(e.reviewed_at * 1000), rating).card;
  }

  return {
    due_at: Math.floor(card.due.getTime() / 1000),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    last_review: card.last_review
      ? Math.floor(card.last_review.getTime() / 1000)
      : null,
  };
}

/**
 * What each of the four buttons would do to this card, without doing it.
 *
 * Design screen 41 prints the interval under every rating in めくる, and its
 * note says that number is the reason four buttons are worth the width. So it
 * has to come from the scheduler: a rule of thumb printed under a button is
 * worse than no number at all, because she would learn to trust it.
 *
 * Returned as seconds from `now`; the client formats. Deliberately not offered
 * for the other three modes — they have no rating row to label.
 */
export function previewIntervals(events, now = new Date()) {
  const ordered = orderEvents(events ?? []);

  let card = createEmptyCard(ordered.length ? new Date(ordered[0].reviewed_at * 1000) : now);
  for (const e of ordered) {
    card = engine.next(card, new Date(e.reviewed_at * 1000), RATINGS[e.rating]).card;
  }

  const scheduled = engine.repeat(card, now);
  const out = {};
  for (const [value, rating] of Object.entries(RATINGS)) {
    out[value] = Math.max(
      0,
      Math.round((scheduled[rating].card.due.getTime() - now.getTime()) / 1000),
    );
  }
  return out;
}
