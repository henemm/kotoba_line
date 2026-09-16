import { visibleTo } from "./cards.js";

/**
 * Per-user settings — §12 and design 22.
 *
 * The Settings screen has no Save button: every control writes as it is
 * touched. That is a design decision with a server consequence — validation
 * cannot live in the form, because a half-typed value never exists and a bad
 * value arrives as a finished request. So the bounds are stated three times on
 * purpose: as a CHECK in the schema, as a JSON schema on the route, and here.
 * The CHECK is the one that cannot be bypassed; the other two exist so a bad
 * value comes back as 400 rather than 500.
 */

/**
 * The three the screen offers. "All" is 60 — MAX_SESSION_LENGTH in queue.js —
 * because an unbounded session is not a session, it is an evening.
 */
export const SESSION_LENGTHS = [10, 20, 60];

/**
 * The new-card limit may not be zero. The product owner ruled that some new
 * material must always keep arriving, which reverses design 22's annotation
 * ("range 0-40, and 0 is legitimate"). See docs/phase-0-plan.md §3.1 E.
 */
export const NEW_PER_DAY_MIN = 5;
export const NEW_PER_DAY_MAX = 40;

/**
 * Both decks the spec names (§5a, §13), in the order the screen lists them.
 * `personal` is reported even while it holds nothing: design 22 keeps the row
 * visible at zero cards so the second import has somewhere to land.
 */
export const DECKS = [
  { key: "kaishi", label: "Kaishi 1.5k" },
  { key: "personal", label: "Personal" },
  // #158. Listed at zero before the kana import, like `personal`.
  { key: "hiragana", label: "Hiragana" },
  { key: "katakana", label: "Katakana" },
];

const COLUMNS = {
  newPerDay: "new_per_day",
  sessionLength: "session_length",
  readAloud: "read_aloud",
  pitchAccent: "pitch_accent",
  romaji: "romaji",
  speakSource: "speak_source",
  japaneseScript: "japanese_script",
  hiddenModes: "hidden_modes",
  appearance: "appearance",
  recordingEnabled: "recording_enabled",
};

/** Light, dark, or the iPhone's own setting (migration 015). Same list as the CHECK. */
export const APPEARANCES = ["light", "dark", "system"];

/** The three 話す can draw a prompt from (#77). Same list as the CHECK in the schema. */
export const SPEAK_SOURCES = ["word", "sentence", "random"];

/**
 * The practice lines, by key — the same five as `client/src/modes.js` and the
 * `mode` of every review event. `hiddenModes` may name at most four of them
 * (#133): hiding the last one would leave a practise tab with nothing to tap.
 */
export const MODE_KEYS = ["choose", "listen", "speak", "type", "flip"];
/** The row as the client sees it: camelCase, and 0/1 as booleans. */
export function settingsForUser(db, userId) {
  const row = db
    .prepare(
      `SELECT new_per_day, session_length, read_aloud, pitch_accent, romaji, speak_source,
              japanese_script, hidden_modes, appearance, recording_enabled
         FROM user_settings WHERE user_id = ?`,
    )
    .get(userId);

  // Every user gets a settings row at creation (users.js), so a missing row
  // means a database written by something other than this server.
  if (!row) throw new Error(`no settings row for user ${userId}`);

  return {
    newPerDay: row.new_per_day,
    sessionLength: row.session_length,
    readAloud: row.read_aloud === 1,
    pitchAccent: row.pitch_accent === 1,
    romaji: row.romaji === 1,
    speakSource: row.speak_source,
    japaneseScript: row.japanese_script === 1,
    appearance: row.appearance,
    hiddenModes: JSON.parse(row.hidden_modes),
    recordingEnabled: row.recording_enabled === 1,
  };
}

/**
 * Apply a partial update. Returns the settings as they now stand, read back
 * from the database rather than assembled from the patch — so what the screen
 * redraws is what was actually stored.
 */
export function updateSettings(db, userId, patch) {
  const assignments = [];
  const values = [];

  for (const [key, column] of Object.entries(COLUMNS)) {
    if (!(key in patch) || patch[key] === undefined) continue;
    assignments.push(`${column} = ?`);
    const value = patch[key];
    if (typeof value === "boolean") values.push(value ? 1 : 0);
    // The one list among the settings, stored as JSON — in the order of the
    // lines themselves, and each key once, whatever order it was sent in.
    else if (Array.isArray(value)) values.push(JSON.stringify(MODE_KEYS.filter((k) => value.includes(k))));
    else values.push(value);
  }

  if (assignments.length > 0) {
    db.prepare(`UPDATE user_settings SET ${assignments.join(", ")} WHERE user_id = ?`).run(
      ...values,
      userId,
    );
  }

  return settingsForUser(db, userId);
}

/**
 * Card counts per deck, with both decks always present.
 *
 * Her own deck counts her own live words (#84) — not every account's, and not
 * the ones she deleted, whose rows stay behind for the event log.
 */
export function deckCounts(db, userId) {
  const v = visibleTo(userId);
  const rows = db
    .prepare(`SELECT c.deck, count(*) n FROM cards c WHERE c.deleted_at IS NULL AND ${v.sql} GROUP BY c.deck`)
    .all(...v.params);
  const byDeck = new Map(rows.map((r) => [r.deck, r.n]));
  return DECKS.map((d) => ({ ...d, cards: byDeck.get(d.key) ?? 0 }));
}

/**
 * What the diagnostics block at the bottom of design 22 can honestly say about
 * synchronisation. It reports the server's side of it — the newest review it
 * holds — rather than a clock on the device, because "synced" is a statement
 * about the log, and the log is what the other device will read.
 */
export function syncStateForUser(db, userId) {
  const row = db
    .prepare(
      "SELECT count(*) n, max(reviewed_at) latest FROM review_events WHERE user_id = ?",
    )
    .get(userId);
  return { events: row.n, lastEventAt: row.latest ?? null };
}
