import { MODE_KEYS } from "./settings.js";

/**
 * Settings that belong to one deck (#137, migration 014): which ways of
 * practising its page offers, and how many new cards it introduces a day.
 *
 * Defaults, for a deck she has not changed:
 *
 * - every way of practising is on; the page leaves out the ones the deck
 *   cannot do (`waysForDeck`), so a default never offers an empty session;
 * - Kaishi keeps the overall limit she had before decks had their own (hers
 *   was 20 on 2026-09-14) — a change of screens should not halve her pace;
 * - a list, and her own words, introduce 10 a day, as each deck did in Noji.
 */
export const LIST_NEW_PER_DAY = 10;

export function deckSettings(db, userId, deckKey) {
  const row = db
    .prepare("SELECT hidden_modes, new_per_day FROM deck_settings WHERE user_id = ? AND deck_key = ?")
    .get(userId, deckKey);
  let fallback = LIST_NEW_PER_DAY;
  if (deckKey === "kaishi") {
    fallback = db.prepare("SELECT new_per_day FROM user_settings WHERE user_id = ?").get(userId)?.new_per_day ?? 15;
  }
  return {
    hiddenModes: row ? JSON.parse(row.hidden_modes) : [],
    newPerDay: row?.new_per_day ?? fallback,
  };
}

/** A partial update, like the overall settings: only the keys that were sent. */
export function updateDeckSettings(db, userId, deckKey, patch, now = Date.now()) {
  const current = db
    .prepare("SELECT hidden_modes, new_per_day FROM deck_settings WHERE user_id = ? AND deck_key = ?")
    .get(userId, deckKey);
  const hidden = patch.hiddenModes
    ? JSON.stringify(MODE_KEYS.filter((k) => patch.hiddenModes.includes(k)))
    : (current?.hidden_modes ?? "[]");
  const perDay = "newPerDay" in patch ? patch.newPerDay : (current?.new_per_day ?? null);
  db.prepare(
    `INSERT INTO deck_settings (user_id, deck_key, hidden_modes, new_per_day, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, deck_key) DO UPDATE
       SET hidden_modes = excluded.hidden_modes, new_per_day = excluded.new_per_day, updated_at = excluded.updated_at`,
  ).run(userId, deckKey, hidden, perDay, Math.floor(now / 1000));
  return deckSettings(db, userId, deckKey);
}
