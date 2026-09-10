/**
 * Her own words — the personal deck (§8, design 27–30).
 *
 * Kaishi's cards are keyed on Anki's note ids, which are epoch milliseconds and
 * therefore always large and positive. **A personal card gets a negative id.**
 * That is not a trick for its own sake: it means the two id spaces can never
 * collide, no counter has to be kept anywhere, and `id < 0` reads as "she made
 * this one" at any point in the system without a join.
 *
 * Everything else about a personal card is ordinary. It lands in the same
 * `cards` table with `deck = 'personal'`, the same `tags` table, and the same
 * scheduler — "so a personal card is not a special case anywhere downstream"
 * (design 28). It has no recorded audio, so it always meets 47's synthesis
 * state, which is already built.
 */

/** Topics are coined on the spot (29), so this is a shape rule, not a list. */
const TAG = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,30}$/u;

export const MAX_TAGS = 5;

export function normaliseTag(tag) {
  const trimmed = String(tag ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return TAG.test(trimmed) ? trimmed : undefined;
}

/**
 * Add one of her own words.
 *
 * Only the word and the meaning are required (28: "three fields required to
 * save, of which one is optional to type well"). The reading and the example
 * sentence are what make the card good, not what make it valid.
 */
export function createCard(db, { word, reading, meaning, sentence, sentenceMeaning, tags = [] }, now = Date.now()) {
  const trimmed = {
    word: String(word ?? "").trim(),
    reading: String(reading ?? "").trim() || null,
    meaning: String(meaning ?? "").trim(),
    sentence: String(sentence ?? "").trim() || null,
    sentenceMeaning: String(sentenceMeaning ?? "").trim() || null,
  };
  if (!trimmed.word || !trimmed.meaning) {
    throw Object.assign(new Error("a word and a meaning are required"), { status: 400 });
  }

  const clean = [...new Set(tags.map(normaliseTag).filter(Boolean))].slice(0, MAX_TAGS);

  // Negative, and unique even when two cards are added in the same
  // millisecond — which a test does, and an impatient thumb might.
  let id = -now;
  const taken = db.prepare("SELECT 1 FROM cards WHERE id = ?");
  while (taken.get(id)) id -= 1;

  const seconds = Math.floor(now / 1000);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO cards
         (id, word, word_furigana, word_reading, word_meaning, word_audio,
          sentence, sentence_furigana, sentence_meaning, sentence_audio,
          frequency_rank, deck, updated_at)
       VALUES (?, ?, NULL, ?, ?, NULL, ?, NULL, ?, NULL, NULL, 'personal', ?)`,
    ).run(id, trimmed.word, trimmed.reading, trimmed.meaning, trimmed.sentence, trimmed.sentenceMeaning, seconds);

    const tag = db.prepare("INSERT OR IGNORE INTO tags (card_id, tag) VALUES (?, ?)");
    for (const t of clean) tag.run(id, t);
  })();

  return getCard(db, id);
}

export function getCard(db, id) {
  const card = db
    .prepare(
      `SELECT id, word, word_furigana, word_reading, word_meaning, word_audio,
              sentence, sentence_furigana, sentence_meaning, sentence_audio,
              frequency_rank, deck, updated_at
         FROM cards WHERE id = ?`,
    )
    .get(id);
  if (!card) return undefined;
  card.tags = db.prepare("SELECT tag FROM tags WHERE card_id = ?").all(id).map((r) => r.tag);
  return card;
}

/**
 * Her own cards, newest first — design 30's list.
 *
 * Newest first rather than by frequency: a personal deck has no frequency
 * order, and the card she just added is the one she is looking for.
 */
export function personalCards(db, userId) {
  const rows = db
    .prepare(
      `SELECT c.id, c.word, c.word_reading, c.word_meaning, c.sentence, c.updated_at,
              s.due_at, s.reps, s.last_review
         FROM cards c
         LEFT JOIN card_state s ON s.card_id = c.id AND s.user_id = ?
        WHERE c.deck = 'personal' AND c.deleted_at IS NULL
        ORDER BY c.id ASC`,
    )
    .all(userId);

  const tags = db
    .prepare(
      `SELECT card_id, tag FROM tags
        WHERE card_id IN (SELECT id FROM cards WHERE deck = 'personal' AND deleted_at IS NULL)`,
    )
    .all();
  const byCard = new Map();
  for (const { card_id, tag } of tags) {
    if (!byCard.has(card_id)) byCard.set(card_id, []);
    byCard.get(card_id).push(tag);
  }

  // Ids are negative epoch milliseconds, so ascending id *is* newest first.
  return rows.map((c) => ({ ...c, tags: byCard.get(c.id) ?? [] }));
}

/**
 * Remove one of her own words.
 *
 * The card leaves the deck; its history stays. §4 makes `review_events`
 * append-only truth, and deleting from it would change a streak she already
 * earned. Design 30 asked for this to be confirmed before the build — this is
 * the confirmation, and the schema had already made the decision: `card_id` is
 * a foreign key, so a reviewed card cannot be removed outright at all.
 */
export function deleteCard(db, id, now = Date.now()) {
  const card = db.prepare("SELECT id, deck, deleted_at FROM cards WHERE id = ?").get(id);
  if (!card) return { ok: false, reason: "not_found" };
  if (card.deck !== "personal") return { ok: false, reason: "not_yours" };
  if (card.deleted_at) return { ok: true };

  const seconds = Math.floor(now / 1000);
  db.transaction(() => {
    // Marked, not removed. `review_events.card_id` is a foreign key, so a card
    // with reviews behind it cannot be deleted outright — and should not be:
    // an old summary still names the word she missed, and §3 promises that
    // card_state can be rebuilt by replaying the log (migration 004).
    db.prepare("UPDATE cards SET deleted_at = ?, updated_at = ? WHERE id = ?").run(
      seconds,
      seconds,
      id,
    );
    // These two are caches and choices, not history: a scheduler row pointing
    // at a card that no longer appears would put a hole in every queue, and a
    // star on a deleted card would count towards a set she cannot practise.
    db.prepare("DELETE FROM card_state WHERE card_id = ?").run(id);
    db.prepare("DELETE FROM card_stars WHERE card_id = ?").run(id);
  })();

  return { ok: true };
}

/** Every topic in use, for 29's "coin a new one" field and 36's chips. */
export function allTags(db) {
  return db
    .prepare(
      `SELECT t.tag, count(*) n FROM tags t
         JOIN cards c ON c.id = t.card_id AND c.deleted_at IS NULL
        GROUP BY t.tag ORDER BY n DESC, t.tag ASC`,
    )
    .all();
}
