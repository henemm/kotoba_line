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
 *
 * The one thing that is special is who may see it (#84). A personal card has
 * an `owner_id`, and every query that hands out or accepts a card goes through
 * `visibleTo()` — the deck sync, the queue, browse, the topic lists, stars,
 * her own topics and review events. Before that column existed a word one
 * account added was in every account's deck.
 */

/**
 * The SQL condition for "this user may see this card", with its parameter.
 *
 * Returned together so a caller cannot use the condition and forget the id —
 * a `?` left unbound would shift every later parameter by one, and the query
 * would quietly read a user id as a search term.
 */
export function visibleTo(userId, alias = "c") {
  return {
    sql: `(${alias}.deck <> 'personal' OR ${alias}.owner_id = ?)`,
    params: [userId],
  };
}

/** One card, if this user may see it and it has not been deleted. */
export function visibleCard(db, userId, cardId) {
  const v = visibleTo(userId);
  return db
    .prepare(`SELECT c.id, c.deck FROM cards c WHERE c.id = ? AND c.deleted_at IS NULL AND ${v.sql}`)
    .get(cardId, ...v.params);
}

/** Topics are coined on the spot (29), so this is a shape rule, not a list. */
const TAG = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,30}$/u;

export const MAX_TAGS = 5;

export function normaliseTag(tag) {
  const trimmed = String(tag ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return TAG.test(trimmed) ? trimmed : undefined;
}

/**
 * The fields of a card she writes, trimmed, with empty optionals as NULL.
 * Shared by adding and editing, so the two cannot disagree on what is valid.
 */
function cleanFields({ word, reading, meaning, sentence, sentenceMeaning, tags = [] }) {
  const fields = {
    word: String(word ?? "").trim(),
    reading: String(reading ?? "").trim() || null,
    meaning: String(meaning ?? "").trim(),
    sentence: String(sentence ?? "").trim() || null,
    sentenceMeaning: String(sentenceMeaning ?? "").trim() || null,
    tags: [...new Set(tags.map(normaliseTag).filter(Boolean))].slice(0, MAX_TAGS),
  };
  if (!fields.word || !fields.meaning) {
    throw Object.assign(new Error("a word and a meaning are required"), { status: 400 });
  }
  return fields;
}

function replaceTags(db, cardId, tags) {
  db.prepare("DELETE FROM tags WHERE card_id = ?").run(cardId);
  const insert = db.prepare("INSERT OR IGNORE INTO tags (card_id, tag) VALUES (?, ?)");
  for (const t of tags) insert.run(cardId, t);
}

/**
 * Add one of her own words.
 *
 * Only the word and the meaning are required (28: "three fields required to
 * save, of which one is optional to type well"). The reading and the example
 * sentence are what make the card good, not what make it valid.
 */
export function createCard(db, userId, input, now = Date.now()) {
  const f = cleanFields(input);

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
          frequency_rank, deck, owner_id, updated_at)
       VALUES (?, ?, NULL, ?, ?, NULL, ?, NULL, ?, NULL, NULL, 'personal', ?, ?)`,
    ).run(id, f.word, f.reading, f.meaning, f.sentence, f.sentenceMeaning, userId, seconds);
    replaceTags(db, id, f.tags);
  })();

  return getCard(db, id);
}

/**
 * Change one of her own words (#85).
 *
 * The whole card, not a patch: the form she edits in holds every field, so
 * what it knows is the final state — the same reasoning as her topics on a
 * card. A field she cleared becomes NULL.
 *
 * Content only. Her history with the card stays exactly as it is: fixing a
 * typo in the meaning is not a reason to forget that she has known the word
 * for three weeks, and `review_events` is append-only anyway (§4).
 * `updated_at` moves, which is what carries the change to her other device.
 */
export function updateCard(db, userId, id, input, now = Date.now()) {
  const card = db.prepare("SELECT deck, owner_id, deleted_at FROM cards WHERE id = ?").get(id);
  // Someone else's word answers exactly like a missing one: saying "not
  // yours" would confirm that the id exists.
  if (!card || card.deleted_at || (card.deck === "personal" && card.owner_id !== userId)) {
    return { ok: false, reason: "not_found" };
  }
  if (card.deck !== "personal") return { ok: false, reason: "not_yours" };

  const f = cleanFields(input);
  const seconds = Math.floor(now / 1000);
  db.transaction(() => {
    db.prepare(
      `UPDATE cards
          SET word = ?, word_reading = ?, word_meaning = ?,
              sentence = ?, sentence_meaning = ?, updated_at = ?
        WHERE id = ?`,
    ).run(f.word, f.reading, f.meaning, f.sentence, f.sentenceMeaning, seconds, id);
    replaceTags(db, id, f.tags);
  })();

  return { ok: true, card: getCard(db, id) };
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
 *
 * The sentence and its meaning come along because the list is also where she
 * opens a word to edit it (#85), and the form has to start from what is there.
 */
export function personalCards(db, userId) {
  const rows = db
    .prepare(
      `SELECT c.id, c.word, c.word_reading, c.word_meaning, c.sentence, c.sentence_meaning,
              c.updated_at, s.due_at, s.reps, s.last_review
         FROM cards c
         LEFT JOIN card_state s ON s.card_id = c.id AND s.user_id = ?
        WHERE c.deck = 'personal' AND c.owner_id = ? AND c.deleted_at IS NULL
        ORDER BY c.id ASC`,
    )
    .all(userId, userId);

  const tags = db
    .prepare(
      `SELECT card_id, tag FROM tags
        WHERE card_id IN (SELECT id FROM cards
                           WHERE deck = 'personal' AND owner_id = ? AND deleted_at IS NULL)`,
    )
    .all(userId);
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
export function deleteCard(db, userId, id, now = Date.now()) {
  const card = db.prepare("SELECT id, deck, owner_id, deleted_at FROM cards WHERE id = ?").get(id);
  // Someone else's word is "not found", for the reason given in updateCard.
  if (!card || (card.deck === "personal" && card.owner_id !== userId)) {
    return { ok: false, reason: "not_found" };
  }
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

/**
 * Every topic in use, for 29's "coin a new one" field and 36's chips.
 *
 * Counted over the cards she can see: a topic a friend coined for a word of
 * their own is not a topic in her deck.
 */
export function allTags(db, userId) {
  const v = visibleTo(userId);
  return db
    .prepare(
      `SELECT t.tag, count(*) n FROM tags t
         JOIN cards c ON c.id = t.card_id AND c.deleted_at IS NULL AND ${v.sql}
        GROUP BY t.tag ORDER BY n DESC, t.tag ASC`,
    )
    .all(...v.params);
}

/**
 * Her own topics on any card, the deck's included (#35).
 *
 * Reported as "ich möchte aus eigenen Kategorien lernen können". She could
 * already coin a topic while adding a word of her own, but there was no way to
 * put one of the 1,500 Kaishi cards into it — so a topic she invented could
 * only ever hold words she had typed herself.
 *
 * Replaces her whole set for that card rather than adding one: the screen is a
 * row of chips she toggles, so the thing it knows is the final set, and an
 * add/remove pair would need the client to work out the difference and get it
 * right. An empty list clears them.
 */
export function setUserTags(db, userId, cardId, tags, now = Date.now()) {
  if (!visibleCard(db, userId, cardId)) return { ok: false, reason: "unknown_card" };

  const clean = [...new Set((tags ?? []).map(normaliseTag).filter(Boolean))].slice(0, MAX_TAGS);
  const seconds = Math.floor(now / 1000);

  db.transaction(() => {
    db.prepare("DELETE FROM card_user_tags WHERE user_id = ? AND card_id = ?").run(userId, cardId);
    const insert = db.prepare(
      "INSERT INTO card_user_tags (user_id, card_id, tag, added_at) VALUES (?, ?, ?, ?)",
    );
    for (const tag of clean) insert.run(userId, cardId, tag, seconds);
  })();

  return { ok: true, cardId, tags: clean };
}

/** Every topic she has coined, with how many cards carry it. */
export function userTags(db, userId) {
  return db
    .prepare(
      `SELECT ut.tag, count(*) n
         FROM card_user_tags ut
         JOIN cards c ON c.id = ut.card_id AND c.deleted_at IS NULL
        WHERE ut.user_id = ?
        GROUP BY ut.tag ORDER BY n DESC, ut.tag ASC`,
    )
    .all(userId);
}

/** Her topics for a given set of cards — for browse, which shows them per row. */
export function userTagsFor(db, userId, cardIds) {
  if (!cardIds?.length) return new Map();
  const holes = cardIds.map(() => "?").join(",");
  const out = new Map();
  for (const { card_id, tag } of db
    .prepare(
      `SELECT card_id, tag FROM card_user_tags
        WHERE user_id = ? AND card_id IN (${holes}) ORDER BY tag ASC`,
    )
    .all(userId, ...cardIds)) {
    if (!out.has(card_id)) out.set(card_id, []);
    out.get(card_id).push(tag);
  }
  return out;
}
