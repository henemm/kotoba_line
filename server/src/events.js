import { visibleTo } from "./cards.js";
import { VALID_MODES, VALID_RATINGS, stateFromEvents } from "./scheduler.js";

const now = () => Math.floor(Date.now() / 1000);

/** A client clock can be wrong, but not this wrong. */
const MAX_FUTURE_SKEW_SECONDS = 24 * 60 * 60;

/**
 * Check one event before it reaches the database.
 *
 * Returns a reason string, or undefined if it is fine. A rejected event is
 * reported back rather than failing the batch: the outbox retries blindly
 * (§4), so an event the server will never accept — a card that no longer
 * exists, say — would otherwise be retried forever.
 */
function reasonToReject(db, userId, event, serverNow) {
  if (!VALID_MODES.includes(event.mode)) return "unknown_mode";
  if (!VALID_RATINGS.includes(event.rating)) return "unknown_rating";
  if (event.reviewed_at > serverNow + MAX_FUTURE_SKEW_SECONDS) return "reviewed_at_in_future";

  // A deleted card still takes events: one answered offline before she deleted
  // it is real history. Someone else's own word never does (#84) — and says
  // so the same way a missing card does.
  const v = visibleTo(userId);
  const card = db.prepare(`SELECT 1 FROM cards c WHERE c.id = ? AND ${v.sql}`).get(event.card_id, ...v.params);
  if (!card) return "unknown_card";

  return undefined;
}

/**
 * Recompute one card's derived state from its whole event history.
 * Deletes the row when no events remain, so card_state never outlives the log.
 */
export function recomputeCardState(db, userId, cardId) {
  const events = db
    .prepare(
      `SELECT id, rating, reviewed_at
         FROM review_events
        WHERE user_id = ? AND card_id = ?`,
    )
    .all(userId, cardId);

  const state = stateFromEvents(events);

  if (!state) {
    db.prepare("DELETE FROM card_state WHERE user_id = ? AND card_id = ?").run(userId, cardId);
    return undefined;
  }

  db.prepare(
    `INSERT INTO card_state
       (user_id, card_id, due_at, stability, difficulty, reps, lapses, last_review)
     VALUES (@user_id, @card_id, @due_at, @stability, @difficulty, @reps, @lapses, @last_review)
     ON CONFLICT (user_id, card_id) DO UPDATE SET
       due_at      = excluded.due_at,
       stability   = excluded.stability,
       difficulty  = excluded.difficulty,
       reps        = excluded.reps,
       lapses      = excluded.lapses,
       last_review = excluded.last_review`,
  ).run({ user_id: userId, card_id: cardId, ...state });

  return { user_id: userId, card_id: cardId, ...state };
}

/**
 * Take a batch of client events (§4).
 *
 * INSERT OR IGNORE on the client-generated UUID, so replaying the same batch
 * is harmless and the client can retry without tracking what succeeded. Every
 * card the batch touched is then recomputed from its full history — including
 * cards whose events were all duplicates, because recomputing is cheap and
 * getting it wrong is not.
 */
export function ingestEvents(db, userId, events, serverNow = now()) {
  const accepted = [];
  const rejected = [];
  const touched = new Set();

  const insert = db.prepare(
    `INSERT OR IGNORE INTO review_events
       (id, user_id, card_id, mode, rating, reviewed_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    for (const event of events) {
      const reason = reasonToReject(db, userId, event, serverNow);
      if (reason) {
        rejected.push({ id: event.id, reason });
        continue;
      }

      insert.run(
        event.id,
        userId,
        event.card_id,
        event.mode,
        event.rating,
        event.reviewed_at,
        serverNow,
      );

      // Acknowledged whether it was new or already present: either way the
      // client may drop it from the outbox, which is what the ack means.
      accepted.push(event.id);
      touched.add(event.card_id);
    }

    for (const cardId of touched) recomputeCardState(db, userId, cardId);
  })();

  const states = [...touched]
    .map((cardId) =>
      db
        .prepare("SELECT * FROM card_state WHERE user_id = ? AND card_id = ?")
        .get(userId, cardId),
    )
    .filter(Boolean);

  return { accepted, rejected, states };
}
