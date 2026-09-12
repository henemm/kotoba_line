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
];

const COLUMNS = {
  newPerDay: "new_per_day",
  sessionLength: "session_length",
  readAloud: "read_aloud",
  pitchAccent: "pitch_accent",
  romaji: "romaji",
};

/** The row as the client sees it: camelCase, and 0/1 as booleans. */
export function settingsForUser(db, userId) {
  const row = db
    .prepare(
      `SELECT new_per_day, session_length, read_aloud, pitch_accent, romaji
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
    values.push(typeof patch[key] === "boolean" ? (patch[key] ? 1 : 0) : patch[key]);
  }

  if (assignments.length > 0) {
    db.prepare(`UPDATE user_settings SET ${assignments.join(", ")} WHERE user_id = ?`).run(
      ...values,
      userId,
    );
  }

  return settingsForUser(db, userId);
}

/** Card counts per deck, with both decks always present. */
export function deckCounts(db) {
  const rows = db.prepare("SELECT deck, count(*) n FROM cards GROUP BY deck").all();
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
