import { canonicalDeckKey, isKanaDeck } from "./decks.js";
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
 * A kana deck introduces 5 a day (#158): its cards are in gojūon order, so
 * that is one row — あいうえお, then かきくけこ — the way kana are taught.
 */
export const KANA_NEW_PER_DAY = 5;

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
    .prepare(
      "SELECT hidden_modes, new_per_day, max_per_day, extra_new, extra_new_day FROM deck_settings WHERE user_id = ? AND deck_key = ?",
    )
    .get(userId, deckKey);
  // Reise 1 and 2 (#252) pace like a list: Reise 1's 21 cards over three days.
  let fallback = isKanaDeck(deckKey) ? KANA_NEW_PER_DAY : LIST_NEW_PER_DAY;
  if (deckKey === "kaishi") {
    fallback = db.prepare("SELECT new_per_day FROM user_settings WHERE user_id = ?").get(userId)?.new_per_day ?? 15;
  }
  return {
    hiddenModes: row ? JSON.parse(row.hidden_modes) : [],
    newPerDay: row?.new_per_day ?? fallback,
    maxPerDay: row?.max_per_day ?? null,
    // What she released on top of the allowance, and the day it was for
    // (#179, migration 021). Whether that day is today is the caller's
    // question — it depends on the device's zone.
    extraNew: row?.extra_new ?? 0,
    extraNewDay: row?.extra_new_day ?? null,
  };
}

/**
 * Raise the deck's allowance for today by one more batch (#179, v90).
 *
 * "One batch" is the deck's own daily number, so tapping it twice on the kana
 * decks releases ten and the rhythm of the deck is what grows. `day` is her
 * device's calendar day (§8a); a row left over from another day starts again
 * at that batch rather than adding to it.
 */
export function releaseNewCards(db, userId, key, day, now = Date.now()) {
  const deckKey = canonicalDeckKey(db, userId, key);
  if (!deckKey) return undefined;
  const before = deckSettings(db, userId, deckKey);
  const released = (before.extraNewDay === day ? before.extraNew : 0) + before.newPerDay;
  db.prepare(
    `INSERT INTO deck_settings (user_id, deck_key, hidden_modes, new_per_day, max_per_day, extra_new, extra_new_day, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, deck_key) DO UPDATE
       SET extra_new = excluded.extra_new, extra_new_day = excluded.extra_new_day,
           updated_at = excluded.updated_at`,
  ).run(
    userId,
    deckKey,
    JSON.stringify(before.hiddenModes),
    before.newPerDay,
    before.maxPerDay,
    released,
    day,
    Math.floor(now / 1000),
  );
  return deckSettings(db, userId, deckKey);
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
