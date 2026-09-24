/**
 * A card asked the other way round (#284, migrations 036 and 037).
 *
 * Noji makes a two-way card into two cards that "start learning
 * independently" (help.noji.io), and Henning chose the same for every deck:
 * the two directions are scored apart. Here the second one is a row of its
 * own with `reverse_of` set: its own id and so its own `card_state` and
 * history. What it asks is the original's, with the other side in front — the
 * client reads `reverse_of` in めくる (`flipsMeaningFirst`), and the queue
 * offers it in that way of practising only (queue.js).
 *
 * A reverse always belongs to the account that switched it on: a card of
 * hers (`deck = 'personal'`, `owner_id`), also when the original is a Kaishi
 * word everyone shares. Which deck it is practised in is its original's
 * (queue.js, `HOME_DECK`). So who may see it is the rule for any card of hers
 * (cards.js, `visibleTo`), and nothing that reads "the Kaishi cards" meets a
 * copy of one.
 *
 * Nothing edits a reverse directly. Its columns follow the original's by a
 * trigger (migration 037); its topics follow by `mirror`, which every writer
 * of topics on an original calls in the same transaction.
 */

import { recomputeCardState } from "./events.js";

/** The columns a new reverse starts from; the trigger keeps them equal. */
const COPIED = [
  "word", "word_furigana", "word_reading", "word_pitch", "word_meaning", "word_audio",
  "sentence", "sentence_furigana", "sentence_meaning", "sentence_audio", "frequency_rank",
  "deck_id", "list_name", "word_examples", "word_mnemonic",
  "word_audio_generated", "word_audio_generated_for", "word_audio_checked",
  "topics_offered_at", "word_meaning_en", "sentence_meaning_en",
];

/** A card's reverse for one account, live or switched off, if it has ever had one. */
export function reverseOf(db, cardId, ownerId) {
  return db.prepare("SELECT id, deleted_at FROM cards WHERE reverse_of = ? AND owner_id = ?").get(cardId, ownerId);
}

/** Whether a card can be asked the other way round at all: not a kana, not a reverse. */
export function reversible(db, cardId) {
  const card = db.prepare("SELECT deck, reverse_of, deleted_at FROM cards WHERE id = ?").get(cardId);
  return Boolean(card && !card.deleted_at && card.reverse_of == null && card.deck !== "hiragana" && card.deck !== "katakana");
}

/**
 * Give a card's live reverses the card's topics again — the deck's, and each
 * owner's own. Does nothing for a card without one, so every writer can call
 * it unconditionally.
 */
export function mirror(db, cardId, seconds) {
  const reverses = db.prepare("SELECT id, owner_id FROM cards WHERE reverse_of = ? AND deleted_at IS NULL").all(cardId);
  for (const rev of reverses) {
    db.prepare("DELETE FROM tags WHERE card_id = ?").run(rev.id);
    db.prepare("INSERT INTO tags (card_id, tag) SELECT ?, tag FROM tags WHERE card_id = ?").run(rev.id, cardId);
    db.prepare("DELETE FROM card_user_tags WHERE card_id = ?").run(rev.id);
    db.prepare(
      `INSERT INTO card_user_tags (user_id, card_id, tag, added_at)
       SELECT user_id, ?, tag, added_at FROM card_user_tags WHERE card_id = ? AND user_id = ?`,
    ).run(rev.id, cardId, rev.owner_id);
    // The phone's copy is refreshed by `updated_at`, topics included.
    db.prepare("UPDATE cards SET updated_at = max(updated_at, ?) WHERE id = ?").run(seconds, rev.id);
  }
}

/**
 * Switch a card's reverse on or off for one account. Returns whether anything
 * changed.
 *
 * On: the reverse it had before if there is one — undeleted, so the answers
 * given to it count again — or a new row. Off: soft-deleted like any card of
 * hers (cards.js, `deleteCard`), for the same reason: `review_events` points
 * at it. Its scheduler row and star go, as they do there.
 *
 * The caller has already checked that the account may see the card and that
 * it is `reversible`.
 */
export function setReverse(db, cardId, on, seconds, ownerId) {
  const rev = reverseOf(db, cardId, ownerId);
  if (!on) {
    if (!rev || rev.deleted_at) return false;
    db.prepare("UPDATE cards SET deleted_at = ?, updated_at = ? WHERE id = ?").run(seconds, seconds, rev.id);
    db.prepare("DELETE FROM card_state WHERE card_id = ?").run(rev.id);
    db.prepare("DELETE FROM card_stars WHERE card_id = ?").run(rev.id);
    return true;
  }
  if (rev && !rev.deleted_at) return false;
  let id;
  if (rev) {
    id = rev.id;
    // Content first: the trigger only follows a live reverse, so while it was
    // off the original may have changed without it.
    db.prepare(
      `UPDATE cards SET (${COPIED.join(", ")}) = (SELECT ${COPIED.join(", ")} FROM cards WHERE id = ?),
              deleted_at = NULL, updated_at = ?
        WHERE id = ?`,
    ).run(cardId, seconds, id);
    // Its answers are still in the log, and the cache is folded from them
    // again (§4) — otherwise the queue would take it for a new card.
    recomputeCardState(db, ownerId, id);
  } else {
    // Negative like every card of hers, and below all of them, so it can
    // never take an id an original's neighbours would (cards.js).
    const lowest = db.prepare("SELECT min(id) m FROM cards").get().m ?? 0;
    id = Math.min(lowest, 0) - 1;
    db.prepare(
      `INSERT INTO cards (id, ${COPIED.join(", ")}, deck, owner_id, reverse_of, updated_at)
       SELECT ?, ${COPIED.join(", ")}, 'personal', ?, id, ? FROM cards WHERE id = ?`,
    ).run(id, ownerId, seconds, cardId);
  }
  mirror(db, cardId, seconds);
  // A star is on the word (queue.js, `setStar`), so a reverse starts with the
  // original's.
  db.prepare(
    `INSERT OR REPLACE INTO card_stars (user_id, card_id, starred, changed_at)
     SELECT user_id, ?, starred, changed_at FROM card_stars WHERE card_id = ? AND user_id = ?`,
  ).run(id, cardId, ownerId);
  return true;
}

/**
 * A deck's „Auch andersherum abfragen" (#284): every card in it switched at
 * once, as Noji's "Select all → Reverse", for one account. `cardIds` are the
 * deck's cards as the caller scoped them (queue.js, `deckCardIds`). Returns how
 * many changed.
 */
export function setDeckReverse(db, cardIds, on, seconds, ownerId) {
  let changed = 0;
  db.transaction(() => {
    for (const id of cardIds) if (reversible(db, id) && setReverse(db, id, on, seconds, ownerId)) changed += 1;
  })();
  return changed;
}
