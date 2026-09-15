import { canonicalDeckKey } from "./decks.js";
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

/**
 * "Max cards per day" (migration 017): new and review together, as in Noji.
 * `null` is no limit, and every deck's default. Same bounds as the CHECK.
 */
export const MAX_PER_DAY_MIN = 10;
export const MAX_PER_DAY_MAX = 500;

export function deckSettings(db, userId, key) {
  // An old spelling ('list:<name>') reads the same row as 'deck:<id>' (migration 016).
  const deckKey = canonicalDeckKey(db, userId, key) ?? key;
  const row = db
    .prepare("SELECT hidden_modes, new_per_day, max_per_day FROM deck_settings WHERE user_id = ? AND deck_key = ?")
    .get(userId, deckKey);
  let fallback = LIST_NEW_PER_DAY;
  if (deckKey === "kaishi") {
    fallback = db.prepare("SELECT new_per_day FROM user_settings WHERE user_id = ?").get(userId)?.new_per_day ?? 15;
  }
  return {
    hiddenModes: row ? JSON.parse(row.hidden_modes) : [],
    newPerDay: row?.new_per_day ?? fallback,
    maxPerDay: row?.max_per_day ?? null,
  };
}

/**
 * A partial update, like the overall settings: only the keys that were sent.
 * Undefined for a deck that is not hers or no longer exists.
 */
export function updateDeckSettings(db, userId, key, patch, now = Date.now()) {
  const deckKey = canonicalDeckKey(db, userId, key);
  if (!deckKey) return undefined;
  const current = db
    .prepare("SELECT hidden_modes, new_per_day, max_per_day FROM deck_settings WHERE user_id = ? AND deck_key = ?")
    .get(userId, deckKey);
  const hidden = patch.hiddenModes
    ? JSON.stringify(MODE_KEYS.filter((k) => patch.hiddenModes.includes(k)))
    : (current?.hidden_modes ?? "[]");
  const perDay = "newPerDay" in patch ? patch.newPerDay : (current?.new_per_day ?? null);
  // `null` is a value here — "no limit" — so only a missing key keeps the old one.
  const maxPerDay = "maxPerDay" in patch ? patch.maxPerDay : (current?.max_per_day ?? null);
  db.prepare(
    `INSERT INTO deck_settings (user_id, deck_key, hidden_modes, new_per_day, max_per_day, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, deck_key) DO UPDATE
       SET hidden_modes = excluded.hidden_modes, new_per_day = excluded.new_per_day,
           max_per_day = excluded.max_per_day, updated_at = excluded.updated_at`,
  ).run(userId, deckKey, hidden, perDay, maxPerDay, Math.floor(now / 1000));
  return deckSettings(db, userId, deckKey);
}
