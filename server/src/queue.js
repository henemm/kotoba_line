/**
 * Building a session's queue (§5, §5a).
 *
 * The server returns card *ids* only. The client already holds the deck in
 * IndexedDB, so sending card content on every session start would waste the
 * very bandwidth §1 is trying to protect.
 */

const DAY = 86400;

/** §5: cards lapsed in the last three days come back regardless of due date. */
const LAPSE_WINDOW_DAYS = 3;

/** §5a and phase-0-plan §3.1 D: "All" is capped so a backlog stays finishable. */
export const MAX_SESSION_LENGTH = 60;

export const ONLY_MODES = ["starred", "lapsed", "new"];

/**
 * Fisher-Yates with an injectable source of randomness, so a test can pin the
 * order without the production path being any less shuffled.
 */
export function shuffle(items, random = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * §5's three groups, in order, de-duplicated: due today oldest first, then
 * anything lapsed in the last three days, then new cards by frequency.
 *
 * Kept pure and separate from the shuffle so the composition rules can be
 * asserted exactly.
 */
export function composeQueue({ due, lapsed, fresh }, limit) {
  const seen = new Set();
  const queue = [];
  for (const group of [due, lapsed, fresh]) {
    for (const id of group) {
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(id);
      if (queue.length >= limit) return queue;
    }
  }
  return queue;
}

/**
 * Whether the session is one the user chose rather than one the scheduler
 * proposed. §5a: "when a filter is active, the scheduler advises rather than
 * decides", and the daily new-card cap applies to unfiltered sessions only.
 */
export function isFiltered({ deck, tag, only }) {
  return Boolean(deck || tag || only);
}

function filterClause({ deck, tag }, params) {
  let sql = "";
  if (deck) {
    sql += " AND c.deck = ?";
    params.push(deck);
  }
  if (tag) {
    sql += " AND EXISTS (SELECT 1 FROM tags t WHERE t.card_id = c.id AND t.tag = ?)";
    params.push(tag);
  }
  return sql;
}

export function queueForUser(db, userId, opts = {}, now = Math.floor(Date.now() / 1000), random = Math.random) {
  const { mode, deck, tag, only } = opts;
  const filtered = isFiltered({ deck, tag, only });

  const requested = Number.isInteger(opts.limit) ? opts.limit : MAX_SESSION_LENGTH;
  const limit = Math.min(Math.max(requested, 1), MAX_SESSION_LENGTH);

  const settings =
    db.prepare("SELECT new_per_day FROM user_settings WHERE user_id = ?").get(userId) ?? {};
  const newPerDay = settings.new_per_day ?? 15;

  // How many new cards were introduced today, so the daily cap is a cap on the
  // day rather than on the session.
  const introducedToday = db
    .prepare(
      `SELECT count(DISTINCT card_id) n
         FROM review_events
        WHERE user_id = ? AND reviewed_at >= ?
          AND card_id NOT IN (
            SELECT card_id FROM review_events
             WHERE user_id = ? AND reviewed_at < ?)`,
    )
    .get(userId, now - DAY, userId, now - DAY).n;

  const starredOnly = only === "starred";

  const base = (extra, params) =>
    `SELECT c.id FROM cards c
      LEFT JOIN card_state s ON s.card_id = c.id AND s.user_id = ?
      ${starredOnly ? "JOIN card_stars st ON st.card_id = c.id AND st.user_id = ?" : ""}
      WHERE 1=1 ${filterClause({ deck, tag }, params)} ${extra}`;

  const run = (extra, order, extraParams = []) => {
    const params = [userId];
    if (starredOnly) params.push(userId);
    const sql = base(extra, params) + " " + order;
    return db.prepare(sql).all(...params, ...extraParams).map((r) => r.id);
  };

  // ── group 1: due ────────────────────────────────────────────────
  const due = run(
    "AND s.card_id IS NOT NULL AND s.due_at <= ?",
    "ORDER BY s.due_at ASC",
    [now],
  );

  // ── group 2: recently lapsed ────────────────────────────────────
  const lapsed = run(
    `AND s.card_id IS NOT NULL AND s.lapses > 0 AND s.last_review >= ?`,
    "ORDER BY s.last_review DESC",
    [now - LAPSE_WINDOW_DAYS * DAY],
  );

  // ── group 3: new ────────────────────────────────────────────────
  // §5a: a deliberately chosen session is never capped by the daily limit.
  const newAllowance = filtered ? limit : Math.max(0, newPerDay - introducedToday);
  const fresh =
    newAllowance === 0
      ? []
      : run(
          "AND s.card_id IS NULL",
          "ORDER BY c.frequency_rank IS NULL, c.frequency_rank ASC LIMIT ?",
          [newAllowance],
        );

  let groups = { due, lapsed, fresh };

  // §5a's `only=` narrows to one group rather than mixing.
  if (only === "lapsed") groups = { due: [], lapsed, fresh: [] };
  else if (only === "new") groups = { due: [], lapsed: [], fresh };

  const queue = composeQueue(groups, limit);

  // How many cards these filters match, before the session cap. Design 36
  // watches this number change on every tap — "she is watching a number, not
  // filling a form" — and its button reads "Start 20 of 34", which needs both.
  const available = groups.due.length + groups.lapsed.length + groups.fresh.length;

  // §5: shuffle within the session so the same cards do not always come in the
  // same order. The composition above decided *which* cards; this decides only
  // the order they are met in.
  return { mode: mode ?? null, filtered, available, cardIds: shuffle(queue, random) };
}

/**
 * A gloss with its punctuation flattened to spaces and a space at each end, so
 * a `LIKE '% word%'` can anchor to the start of a word.
 *
 * Nested REPLACE rather than a full-text index: at 1,500 rows the scan costs
 * nothing, and FTS5 would need a shadow table kept in step with every import
 * for a search that is only ever one short word.
 */
function normalisedGloss(column) {
  const punctuation = [",", ";", "(", ")", "[", "]", "/", "-", ".", "!", "?", "'", '"'];
  let expr = `lower(${column})`;
  for (const ch of punctuation) expr = `replace(${expr}, '${ch === "'" ? "''" : ch}', ' ')`;
  return `' ' || ${expr} || ' '`;
}

/**
 * §5a's browse screen: search by Japanese or by English gloss, filter by deck
 * and tag, and see what is starred.
 */
export function browseCards(db, userId, { q, deck, tag, starred, page = 0, pageSize = 50 } = {}) {
  // Join parameters and filter parameters are kept apart deliberately: mixing
  // them is how a query ends up reading a user id as a search term.
  const whereParams = [];
  let where = "WHERE 1=1";

  if (q) {
    // Japanese has no word boundaries, so a substring match is right for the
    // word and its reading. The English gloss is different: a plain substring
    // makes "eat" match "create", "great" and "weather", which is most of what
    // she would get back. Anchoring to the start of a word keeps "eating" and
    // "eats" while dropping all three of those.
    //
    // The gloss is padded and its punctuation flattened to spaces first, so a
    // word at the very start, or after a comma or a bracket, still counts.
    // The reading is searched through `word_reading`, the plain kana, and not
    // through `word_furigana`: that one is Anki's `食[た]べる`, where たべ is
    // split around the bracket and can never match (migration 003).
    where +=
      " AND (c.word LIKE ? OR c.word_reading LIKE ? OR c.word_furigana LIKE ? OR " +
      `${normalisedGloss("c.word_meaning")} LIKE ?)`;
    whereParams.push(`%${q}%`, `%${q}%`, `%${q}%`, `% ${q.toLowerCase()}%`);
  }
  if (deck) {
    where += " AND c.deck = ?";
    whereParams.push(deck);
  }
  if (tag) {
    where += " AND EXISTS (SELECT 1 FROM tags t WHERE t.card_id = c.id AND t.tag = ?)";
    whereParams.push(tag);
  }
  if (starred) {
    where += " AND EXISTS (SELECT 1 FROM card_stars s2 WHERE s2.card_id = c.id AND s2.user_id = ?)";
    whereParams.push(userId);
  }

  const size = Math.min(Math.max(pageSize, 1), 200);
  const offset = Math.max(page, 0) * size;

  const cards = db
    .prepare(
      `SELECT c.id, c.word, c.word_furigana, c.word_reading, c.word_meaning,
              c.deck, c.frequency_rank,
              st.card_id IS NOT NULL AS starred,
              s.due_at, s.reps, s.last_review
         FROM cards c
         LEFT JOIN card_stars st ON st.card_id = c.id AND st.user_id = ?
         LEFT JOIN card_state  s ON s.card_id  = c.id AND s.user_id  = ?
         ${where}
        ORDER BY c.frequency_rank IS NULL, c.frequency_rank ASC, c.id ASC
        LIMIT ? OFFSET ?`,
    )
    .all(userId, userId, ...whereParams, size, offset)
    .map((r) => ({ ...r, starred: Boolean(r.starred) }));

  const { n: total } = db
    .prepare(`SELECT count(*) n FROM cards c ${where}`)
    .get(...whereParams);

  return { page, pageSize: size, total, cards };
}

export function setStar(db, userId, cardId, starred) {
  const exists = db.prepare("SELECT 1 FROM cards WHERE id = ?").get(cardId);
  if (!exists) return { ok: false, reason: "unknown_card" };

  if (starred) {
    db.prepare(
      `INSERT OR IGNORE INTO card_stars (user_id, card_id, added_at)
       VALUES (?, ?, ?)`,
    ).run(userId, cardId, Math.floor(Date.now() / 1000));
  } else {
    db.prepare("DELETE FROM card_stars WHERE user_id = ? AND card_id = ?").run(userId, cardId);
  }
  return { ok: true, cardId, starred };
}
