import { stateFromEvents } from "./scheduler.js";

/**
 * Rebuild card_state from review_events (§3).
 *
 * "If scheduling ever produces something odd, delete card_state and replay the
 * event log." This is that function. The brief asks for it in this phase rather
 * than later, and it earns its place immediately: it is also the oracle the
 * idempotency test compares against, so a bug in the incremental path shows up
 * as a disagreement with a full rebuild.
 *
 * Pass a userId to rebuild one user, or omit it to rebuild everyone.
 */
export function replayCardState(db, { userId } = {}) {
  const rows = userId
    ? db
        .prepare(
          `SELECT user_id, card_id, id, rating, reviewed_at
             FROM review_events WHERE user_id = ?`,
        )
        .all(userId)
    : db
        .prepare("SELECT user_id, card_id, id, rating, reviewed_at FROM review_events")
        .all();

  // Group in memory: at this scale the whole log is a few hundred thousand
  // rows at most, and one pass beats a query per card.
  const byCard = new Map();
  for (const row of rows) {
    const key = `${row.user_id}:${row.card_id}`;
    let bucket = byCard.get(key);
    if (!bucket) byCard.set(key, (bucket = []));
    bucket.push(row);
  }

  const upsert = db.prepare(
    `INSERT INTO card_state
       (user_id, card_id, due_at, stability, difficulty, reps, lapses, last_review)
     VALUES (@user_id, @card_id, @due_at, @stability, @difficulty, @reps, @lapses, @last_review)`,
  );

  return db.transaction(() => {
    if (userId) {
      db.prepare("DELETE FROM card_state WHERE user_id = ?").run(userId);
    } else {
      db.prepare("DELETE FROM card_state").run();
    }

    let rebuilt = 0;
    for (const events of byCard.values()) {
      const state = stateFromEvents(events);
      if (!state) continue;
      upsert.run({
        user_id: events[0].user_id,
        card_id: events[0].card_id,
        ...state,
      });
      rebuilt += 1;
    }
    return { cards: rebuilt, events: rows.length };
  })();
}
