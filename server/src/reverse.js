/**
 * A card of hers asked the other way round (#284, migration 036).
 *
 * Noji makes a two-way card into two cards that "start learning
 * independently" (help.noji.io). Here the second one is a row of its own with
 * `reverse_of` set: its own id and so its own `card_state` and history. What
 * it asks is the original's, with the other side in front — the client reads
 * `reverse_of` in めくる (`flipsMeaningFirst`), and the queue offers it in
 * that way of practising only (queue.js).
 *
 * Nothing edits a reverse directly. Its columns follow the original's by a
 * trigger (migration 036); its topics follow by `mirror`, which every writer
 * of topics on an original calls in the same transaction.
 */

import { recomputeCardState } from "./events.js";

/** The columns a new reverse starts from; the trigger keeps them equal. */
const COPIED = [
  "word", "word_furigana", "word_reading", "word_pitch", "word_meaning", "word_audio",
  "sentence", "sentence_furigana", "sentence_meaning", "sentence_audio",
  "deck", "owner_id", "deck_id", "list_name", "word_examples", "word_mnemonic",
  "word_audio_generated", "word_audio_generated_for", "word_audio_checked",
  "topics_offered_at", "word_meaning_en", "sentence_meaning_en",
];

/** The reverse of a card, live or switched off, if it has ever had one. */
export function reverseOf(db, cardId) {
  return db.prepare("SELECT id, deleted_at FROM cards WHERE reverse_of = ?").get(cardId);
}

/**
 * Give a card's reverse the card's topics again — the deck's and the owner's
 * own. Does nothing for a card without a live reverse, so every writer can
 * call it unconditionally.
 */
export function mirror(db, cardId, seconds) {
  const rev = reverseOf(db, cardId);
  if (!rev || rev.deleted_at) return;
  db.prepare("DELETE FROM tags WHERE card_id = ?").run(rev.id);
  db.prepare("INSERT INTO tags (card_id, tag) SELECT ?, tag FROM tags WHERE card_id = ?").run(rev.id, cardId);
  db.prepare("DELETE FROM card_user_tags WHERE card_id = ?").run(rev.id);
  db.prepare(
    `INSERT INTO card_user_tags (user_id, card_id, tag, added_at)
     SELECT user_id, ?, tag, added_at FROM card_user_tags WHERE card_id = ?`,
  ).run(rev.id, cardId);
  // The phone's copy is refreshed by `updated_at`, topics included.
  db.prepare("UPDATE cards SET updated_at = max(updated_at, ?) WHERE id = ?").run(seconds, rev.id);
}

/**
 * Switch a card's reverse on or off. Returns whether anything changed.
 *
 * On: the reverse it had before if there is one — undeleted, so the answers
 * she gave it count again — or a new row. Off: soft-deleted like any card of
 * hers (cards.js, `deleteCard`), for the same reason: `review_events` points
 * at it. Its scheduler row and star go, as they do there.
 *
 * The caller has already checked that the card is hers and live.
 */
export function setReverse(db, cardId, on, seconds) {
  const rev = reverseOf(db, cardId);
  if (!on) {
    if (!rev || rev.deleted_at) return false;
    db.prepare("UPDATE cards SET deleted_at = ?, updated_at = ? WHERE id = ?").run(seconds, seconds, rev.id);
    db.prepare("DELETE FROM card_state WHERE card_id = ?").run(rev.id);
    db.prepare("DELETE FROM card_stars WHERE card_id = ?").run(rev.id);
    return true;
  }
  if (rev && !rev.deleted_at) return false;
  if (rev) {
    // Content first: the trigger only follows a live reverse, so while it was
    // off the original may have changed without it.
    db.prepare(
      `UPDATE cards SET (${COPIED.join(", ")}) = (SELECT ${COPIED.join(", ")} FROM cards WHERE id = ?),
              deleted_at = NULL, updated_at = ?
        WHERE id = ?`,
    ).run(cardId, seconds, rev.id);
    // Its answers are still in the log, and the cache is folded from them
    // again (§4) — otherwise the queue would take it for a new card.
    const { owner_id } = db.prepare("SELECT owner_id FROM cards WHERE id = ?").get(cardId);
    recomputeCardState(db, owner_id, rev.id);
  } else {
    // Negative like every card of hers, and below all of them, so it can
    // never take an id an original's neighbours would (cards.js).
    const lowest = db.prepare("SELECT min(id) m FROM cards").get().m ?? 0;
    db.prepare(
      `INSERT INTO cards (id, ${COPIED.join(", ")}, reverse_of, updated_at)
       SELECT ?, ${COPIED.join(", ")}, id, ? FROM cards WHERE id = ?`,
    ).run(Math.min(lowest, 0) - 1, seconds, cardId);
  }
  mirror(db, cardId, seconds);
  // A star is on the word (queue.js, `setStar`), so a reverse starts with the
  // original's.
  db.prepare(
    `INSERT OR REPLACE INTO card_stars (user_id, card_id, starred, changed_at)
     SELECT user_id, (SELECT id FROM cards WHERE reverse_of = ?), starred, changed_at
       FROM card_stars WHERE card_id = ?`,
  ).run(cardId, cardId);
  return true;
}
