/**
 * Her own decks (#137, migration 016).
 *
 * Like Noji: a deck holds its cards, she adds cards while she is in it, starts
 * a new one with a name, and renames or deletes one from its options (Henning,
 * 2026-09-14). Every card of her own is in exactly one of her decks. Kaishi is
 * not a deck row — it is everyone's and nobody's to edit — and is keyed
 * 'kaishi' wherever a deck key is.
 *
 * A deck key is what the client sends: 'kaishi' or 'deck:<id>'. Two older
 * spellings still resolve, for phones that have not updated: 'list:<name>'
 * (v60–v67) and 'mine' (her words outside any list, now the deck "My words").
 */

/** Where a card goes when nothing says which deck: what "Add a word" did before decks. */
export const MY_WORDS = "My words";

export const DECK_NAME_MAX = 60;

/** Trimmed, inner whitespace collapsed; undefined when nothing is left. */
export function cleanDeckName(name) {
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  return clean && clean.length <= DECK_NAME_MAX ? clean : undefined;
}

/** One of her live decks, or undefined — someone else's deck included. */
export function ownDeck(db, userId, id) {
  return db
    .prepare("SELECT id, name, created_at FROM decks WHERE id = ? AND owner_id = ? AND deleted_at IS NULL")
    .get(id, userId);
}

function deckNamed(db, userId, name) {
  return db
    .prepare("SELECT id, name, created_at FROM decks WHERE owner_id = ? AND name = ? AND deleted_at IS NULL")
    .get(userId, name);
}

/**
 * The key per-deck settings are stored under, or undefined for a deck that
 * does not exist (any more). An old spelling becomes 'deck:<id>'.
 */
export function canonicalDeckKey(db, userId, key) {
  if (key === "kaishi") return "kaishi";
  if (typeof key !== "string") return undefined;
  let deck;
  if (/^deck:\d+$/.test(key)) deck = ownDeck(db, userId, Number(key.slice(5)));
  else if (key === "mine") deck = deckNamed(db, userId, MY_WORDS);
  else if (key.startsWith("list:")) deck = deckNamed(db, userId, key.slice(5));
  return deck ? `deck:${deck.id}` : undefined;
}

/** A new, empty deck. A name she already uses for a live deck is refused. */
export function createDeck(db, userId, name, now = Date.now()) {
  const clean = cleanDeckName(name);
  if (!clean) return { ok: false, reason: "bad_name" };
  if (deckNamed(db, userId, clean)) return { ok: false, reason: "name_taken" };
  const seconds = Math.floor(now / 1000);
  const { lastInsertRowid } = db
    .prepare("INSERT INTO decks (owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(userId, clean, seconds, seconds);
  return { ok: true, deck: ownDeck(db, userId, Number(lastInsertRowid)) };
}

/** The deck "name", made if she has none by that name yet. For imports and old clients. */
export function deckIdFor(db, userId, name, now = Date.now()) {
  const existing = deckNamed(db, userId, name);
  if (existing) return existing.id;
  const made = createDeck(db, userId, name, now);
  if (!made.ok) throw new Error(`cannot make deck ${JSON.stringify(name)}: ${made.reason}`);
  return made.deck.id;
}

/**
 * A new name. Nothing else changes: the cards point at the deck's number, and
 * so do its settings — which is why a deck has one.
 */
export function renameDeck(db, userId, id, name, now = Date.now()) {
  if (!ownDeck(db, userId, id)) return { ok: false, reason: "not_found" };
  const clean = cleanDeckName(name);
  if (!clean) return { ok: false, reason: "bad_name" };
  const other = deckNamed(db, userId, clean);
  if (other && other.id !== id) return { ok: false, reason: "name_taken" };
  db.prepare("UPDATE decks SET name = ?, updated_at = ? WHERE id = ?").run(clean, Math.floor(now / 1000), id);
  return { ok: true, deck: ownDeck(db, userId, id) };
}

/**
 * The deck and every card in it, the way one card is deleted (cards.js):
 * marked rather than removed, since `review_events` point at the cards, with
 * the scheduler rows and stars that would otherwise point at nothing. Her
 * history stays in the log. The deck's settings go.
 */
export function deleteDeck(db, userId, id, now = Date.now()) {
  if (!ownDeck(db, userId, id)) return { ok: false, reason: "not_found" };
  const seconds = Math.floor(now / 1000);
  let cards = 0;
  db.transaction(() => {
    const inDeck = "SELECT id FROM cards WHERE deck_id = ? AND owner_id = ? AND deleted_at IS NULL";
    db.prepare(`DELETE FROM card_state WHERE card_id IN (${inDeck})`).run(id, userId);
    db.prepare(`DELETE FROM card_stars WHERE card_id IN (${inDeck})`).run(id, userId);
    cards = db
      .prepare("UPDATE cards SET deleted_at = ?, updated_at = ? WHERE deck_id = ? AND owner_id = ? AND deleted_at IS NULL")
      .run(seconds, seconds, id, userId).changes;
    db.prepare("DELETE FROM deck_settings WHERE user_id = ? AND deck_key = ?").run(userId, `deck:${id}`);
    db.prepare("UPDATE decks SET deleted_at = ?, updated_at = ? WHERE id = ?").run(seconds, seconds, id);
  })();
  return { ok: true, cards };
}

/** Her live decks, oldest first: the order the practise tab lists them in. */
export function ownDecks(db, userId) {
  return db
    .prepare("SELECT id, name, created_at FROM decks WHERE owner_id = ? AND deleted_at IS NULL ORDER BY id")
    .all(userId);
}
