import { userTagsFor, visibleCard, visibleTo } from "./cards.js";
import { deckSettings } from "./deck-settings.js";
import { KANA_DECKS, MY_WORDS, isKanaDeck, ownDecks } from "./decks.js";
import { DEFAULT_TIME_ZONE, dayIn, nextDay, startOfDay } from "./day.js";
import { maturityBand } from "./stats.js";
// The client's own module, not a copy (v69): the image puts client/src/romaji.js
// and pitch.js at /client/src, the same place relative to src/ as in the repo.
import { romajiQuery, searchRomaji } from "../../client/src/romaji.js";

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

/** Design 10's "Practise ahead": cards due in the next two days (#90). */
const AHEAD_WINDOW_DAYS = 2;

export const ONLY_MODES = ["starred", "lapsed", "new", "ahead"];

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
 *
 * A deck is not such a filter (#137), a deviation from §5a. The practise tab
 * starts with her decks, so a deck is *where* she learns rather than a
 * narrowing for one session: uncapped, every session in one of her lists
 * would bring 20 new words, several times a day, and the reviews those make
 * would pile up within the week. So the scheduler still decides inside a deck
 * — its own daily cap, due count, the nothing-due outlook — and only a topic
 * or an `only` hands the decision to her.
 */
export function isFiltered({ tag, only }) {
  return Boolean(tag || only);
}

/**
 * A deck as the practise tab names it (#137): `kaishi`, or `deck:<id>` for one
 * of her own (migration 016). The key is what the client sends and what
 * per-deck settings are stored under. `list:<name>` and `mine` are how v60–v67
 * named her decks, and resolve by name for a phone that has not updated.
 * Anything else is not a deck.
 */
export const DECK_KEY_PATTERN = "^(kaishi|hiragana|katakana|deck:[0-9]{1,15}|mine|list:.{1,100})$";

export function parseDeckKey(key) {
  // The kana decks (#158) are a `cards.deck` of their own, like Kaishi.
  if (key === "kaishi" || isKanaDeck(key)) return { deck: key };
  if (typeof key !== "string") return undefined;
  if (/^deck:\d{1,15}$/.test(key)) return { deck: "personal", deckId: Number(key.slice(5)) };
  if (key === "mine") return { deck: "personal", deckName: MY_WORDS };
  if (key.startsWith("list:") && key.length > 5) return { deck: "personal", deckName: key.slice(5) };
  return undefined;
}

/** One of her decks by name, as SQL: the old keys, and v60–v62's `list`. */
function byDeckName(name, params, userId) {
  params.push(userId, name);
  return " AND c.deck_id = (SELECT d.id FROM decks d WHERE d.owner_id = ? AND d.name = ? AND d.deleted_at IS NULL)";
}

/**
 * The deck's topics and hers are one namespace to a filter (#35).
 *
 * A topic is a topic: when she picks one she means "cards under this", and
 * whether the name was written by the import or by her own hand is a fact
 * about where it lives, not about what she asked for. So a tag matches if it
 * is on the card in `tags` *or* in her `card_user_tags`.
 *
 * That also means she can put a card into a topic the deck already has, rather
 * than being locked out of `food` because the import owns the name.
 */
function filterClause({ deckKey, deck, list, tag }, params, userId) {
  let sql = "";
  // The practise tab's deck (#137). `deck` and `list` below are what v60–v62
  // clients send, and keep working for a phone that has not updated yet.
  const scope = parseDeckKey(deckKey);
  if (scope) {
    sql += " AND c.deck = ?";
    params.push(scope.deck);
    if (scope.deckId !== undefined) {
      sql += " AND c.deck_id = ?";
      params.push(scope.deckId);
    }
    if (scope.deckName !== undefined) sql += byDeckName(scope.deckName, params, userId);
  }
  if (deck) {
    sql += " AND c.deck = ?";
    params.push(deck);
  }
  // One of her imported lists (#137), from a v60–v62 phone: the deck that
  // list became. visibleTo() keeps the cards hers.
  if (list) {
    sql += " AND c.deck = 'personal'";
    sql += byDeckName(list, params, userId);
  }
  if (tag) {
    sql +=
      " AND (EXISTS (SELECT 1 FROM tags t WHERE t.card_id = c.id AND t.tag = ?)" +
      " OR EXISTS (SELECT 1 FROM card_user_tags ut" +
      " WHERE ut.card_id = c.id AND ut.user_id = ? AND ut.tag = ?))";
    params.push(tag, userId, tag);
  }
  return sql;
}

export function queueForUser(db, userId, opts = {}, now = Math.floor(Date.now() / 1000), random = Math.random) {
  const { mode, deckKey, deck, list, tag, only, timeZone = DEFAULT_TIME_ZONE } = opts;
  const filtered = isFiltered({ tag, only });

  const requested = Number.isInteger(opts.limit) ? opts.limit : MAX_SESSION_LENGTH;
  const limit = Math.min(Math.max(requested, 1), MAX_SESSION_LENGTH);

  // A deck has its own daily limit (#137, migration 014), as each deck had in
  // Noji: new cards in "1000" no longer use up the day's new cards in Kaishi.
  // Without a deck — a phone still on v62 — the overall limit covers everything.
  const inDeck = parseDeckKey(deckKey) !== undefined;
  const ofDeck = inDeck ? deckSettings(db, userId, deckKey) : undefined;
  const newPerDay =
    ofDeck?.newPerDay ??
    (db.prepare("SELECT new_per_day FROM user_settings WHERE user_id = ?").get(userId)?.new_per_day ?? 15);

  // How many new cards were introduced today — in this deck, when there is
  // one — so the daily cap is a cap on the day rather than on the session.
  //
  // Today is the calendar day on her device, from its midnight (#122). It was
  // the last 24 hours, so ten new cards at 22:00 still used up ten of the next
  // morning's. One boundary for both halves: "first answered today" only means
  // that if "before today" is the same moment.
  const dayStart = startOfDay(dayIn(now, timeZone), timeZone);
  const scopeParams = [];
  const scopeSql = inDeck ? filterClause({ deckKey }, scopeParams, userId) : "";
  const introducedToday = db
    .prepare(
      `SELECT count(DISTINCT e.card_id) n
         FROM review_events e JOIN cards c ON c.id = e.card_id
        WHERE e.user_id = ? AND e.reviewed_at >= ?
          AND e.card_id NOT IN (
            SELECT card_id FROM review_events
             WHERE user_id = ? AND reviewed_at < ?)${scopeSql}`,
    )
    .get(userId, dayStart, userId, dayStart, ...scopeParams).n;

  // The deck's "Max cards per day" (migration 017), new and review together:
  // what is left of it after the cards she has already answered today in this
  // deck. Undefined with no limit, and for a set she chose (§5a).
  const maxPerDay = !filtered ? ofDeck?.maxPerDay : undefined;
  const leftToday =
    maxPerDay == null
      ? undefined
      : Math.max(
          0,
          maxPerDay -
            db
              .prepare(
                `SELECT count(DISTINCT e.card_id) n
                   FROM review_events e JOIN cards c ON c.id = e.card_id
                  WHERE e.user_id = ? AND e.reviewed_at >= ?${scopeSql}`,
              )
              .get(userId, dayStart, ...scopeParams).n,
        );

  const starredOnly = only === "starred";

  // Someone else's own words are never in her queue (#84).
  const visible = visibleTo(userId);

  const base = (extra, params) =>
    `SELECT c.id FROM cards c
      LEFT JOIN card_state s ON s.card_id = c.id AND s.user_id = ?
      ${starredOnly ? "JOIN card_stars st ON st.card_id = c.id AND st.user_id = ? AND st.starred = 1" : ""}
      WHERE c.deleted_at IS NULL AND ${visible.sql} ${filterClause({ deckKey, deck, list, tag }, params, userId)} ${extra}`;

  const run = (extra, order, extraParams = []) => {
    const params = [userId];
    if (starredOnly) params.push(userId);
    // Before filterClause runs, because its placeholders come after this one.
    params.push(...visible.params);
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
          // Personal cards have no rank; among them, ascending id — the order
          // of an imported list (#137), and newest first for words she added.
          "ORDER BY c.frequency_rank IS NULL, c.frequency_rank ASC, c.id ASC LIMIT ?",
          [newAllowance],
        );

  let groups = { due, lapsed, fresh };

  // The day's maximum takes reviews first, then new cards, in the order the
  // session meets them — as Noji does. What it holds back is due tomorrow still.
  let maxReached = false;
  if (leftToday !== undefined) {
    const reviews = [...new Set([...due, ...lapsed])];
    const kept = new Set(reviews.slice(0, leftToday));
    maxReached = leftToday === 0 && reviews.length + fresh.length > 0;
    groups = {
      due: due.filter((id) => kept.has(id)),
      lapsed: lapsed.filter((id) => kept.has(id)),
      fresh: fresh.slice(0, Math.max(0, leftToday - kept.size)),
    };
  }

  // §5a's `only=` narrows to one group rather than mixing.
  if (only === "lapsed") groups = { due: [], lapsed, fresh: [] };
  else if (only === "new") groups = { due: [], lapsed: [], fresh };
  else if (only === "ahead") {
    // #90: design 10 offers this when nothing is due, and it is what it says —
    // cards the scheduler will ask for within two days, soonest first. Anything
    // already due counts too: it is due within two days, and a device that
    // opened the tab a minute before a card fell due should not miss it.
    groups = {
      due: run(
        "AND s.card_id IS NOT NULL AND s.due_at <= ?",
        "ORDER BY s.due_at ASC",
        [now + AHEAD_WINDOW_DAYS * DAY],
      ),
      lapsed: [],
      fresh: [],
    };
  }

  // Whether today's new cards are what is missing (#137): unseen cards are
  // there, the daily limit has let through all it will. With a deck or list
  // she practises in, this is an ordinary evening, and the set sheet says so
  // instead of "Nothing matches" — which would send her looking for a wrong
  // choice she never made.
  const newCapReached =
    !filtered && newAllowance === 0 && only !== "lapsed" && only !== "ahead"
      ? run("AND s.card_id IS NULL", "LIMIT 1").length > 0
      : false;

  const queue = composeQueue(groups, limit);

  // Today's cards in the deck, without the session cap: #137's deck page,
  // "10 cards for today · 10 new · 0 to review". A due card can also be a
  // recent lapse, so those two are counted as a set; a fresh card has no
  // scheduler row and can be neither.
  const reviewIds = new Set([...groups.due, ...groups.lapsed]);
  const reviews = reviewIds.size;
  const today = { total: reviews + groups.fresh.length, fresh: groups.fresh.length, review: reviews };

  // #159: inside a deck, what Noji's deck page shows — the whole deck in three
  // bands, and today's reviews split into the same two that can be due. Over
  // the deck, not the chosen set: it is the deck's progress, whatever this
  // session narrows to.
  const progress = inDeck ? deckProgress(db, userId, deckKey) : undefined;
  if (progress) {
    let mastered = 0;
    for (const id of reviewIds) if (progress.bands.get(id) === "mastered") mastered += 1;
    today.learning = reviews - mastered;
    today.mastered = mastered;
  }

  // How many cards these filters match, before the session cap. Design 36
  // watches this number change on every tap — "she is watching a number, not
  // filling a form" — and its button reads "Start 20 of 34", which needs both.
  const available = groups.due.length + groups.lapsed.length + groups.fresh.length;

  // §5: shuffle within the session so the same cards do not always come in the
  // same order. The composition above decided *which* cards; this decides only
  // the order they are met in.
  return {
    mode: mode ?? null,
    filtered,
    available,
    today,
    ...(progress ? { progress: progress.counts } : {}),
    newCapReached,
    maxReached,
    cardIds: shuffle(queue, random),
  };
}

/**
 * Noji's three words for how far a card is (#159): "Nicht gelernt", "In
 * Bearbeitung", "Gemeistert". Charlotte reads them there, so the deck page
 * uses them rather than the Stats tab's four bands. "Mastered" is the Stats
 * tab's "mature" — the scheduler waits three weeks or more before asking
 * again — and the other two bands are what is left of it: a card never
 * answered, and everything in between.
 */
export function progressBand(state) {
  const band = maturityBand(state);
  if (band === "new") return "new";
  return band === "mature" ? "mastered" : "learning";
}

/** The deck's cards in those three bands, with each card's band for today's split. */
export function deckProgress(db, userId, deckKey) {
  const params = [userId];
  const visible = visibleTo(userId);
  params.push(...visible.params);
  const sql = `SELECT c.id, s.due_at, s.last_review, s.reps FROM cards c
    LEFT JOIN card_state s ON s.card_id = c.id AND s.user_id = ?
    WHERE c.deleted_at IS NULL AND ${visible.sql} ${filterClause({ deckKey }, params, userId)}`;
  const counts = { total: 0, new: 0, learning: 0, mastered: 0 };
  const bands = new Map();
  for (const row of db.prepare(sql).all(...params)) {
    const band = progressBand(row.reps == null ? undefined : row);
    bands.set(row.id, band);
    counts[band] += 1;
    counts.total += 1;
  }
  return { counts, bands };
}

/**
 * The practise tab's deck list (#137): her decks, the way Noji starts — each
 * with its cards for today.
 *
 * Kaishi first, then her lists in the order they came in, then the words she
 * added herself outside any list. A deck with no cards is left out. "For
 * today" is the queue's own count for that deck, so a number on the list is
 * always the session the deck page then starts.
 */
export function decksForUser(db, userId, now = Math.floor(Date.now() / 1000), timeZone = DEFAULT_TIME_ZONE) {
  // What each way of practising can ask in this deck, the rule playableIn
  // (client/src/screens/session.js) applies card by card: 聞く needs a sentence
  // with a translation, 書く a reading. Counted so the deck's options can say
  // "not possible here" instead of opening a session with nothing in it.
  const count = db.prepare(
    `SELECT count(*) AS cards, count(s.card_id) AS seen,
            sum(c.sentence IS NOT NULL AND c.sentence_meaning IS NOT NULL) AS listen,
            sum(c.word_reading IS NOT NULL OR c.word_furigana IS NOT NULL) AS type
       FROM cards c LEFT JOIN card_state s ON s.card_id = c.id AND s.user_id = ?
      WHERE c.deleted_at IS NULL AND c.deck = ? AND (c.deck <> 'personal' OR c.owner_id = ?)
        AND (? IS NULL OR c.deck_id = ?)`,
  );

  // Kaishi, the kana decks (#158) once imported, then her decks oldest first (migration 016 made her lists decks
  // in the order this list showed them). One of hers is listed empty: a deck
  // she just made is where she adds its first card.
  const candidates = [
    { key: "kaishi", name: "Kaishi", own: false },
    ...KANA_DECKS.map((d) => ({ ...d, own: false })),
    ...ownDecks(db, userId).map((d) => ({ key: `deck:${d.id}`, id: d.id, name: d.name, own: true })),
  ];

  return candidates
    .map(({ key, id, name, own }) => {
      const scope = parseDeckKey(key);
      const row = count.get(userId, scope.deck, userId, id ?? null, id ?? null);
      if (row.cards === 0 && !own) return undefined;
      const { today } = queueForUser(db, userId, { deckKey: key, timeZone }, now);
      return {
        key,
        id,
        own,
        name,
        cards: row.cards,
        seen: row.seen,
        today,
        ways: waysFor(key, row),
        settings: deckSettings(db, userId, key),
      };
    })
    .filter(Boolean);
}

/**
 * How many cards each way of practising can ask in a deck.
 *
 * A kana deck (#158) asks only two ways. 選ぶ shows the kana and offers
 * readings; めくる shows it and turns over to the reading and the stroke
 * order. 話す and 書く prompt with the card's meaning — for a kana that is
 * its reading, so the prompt would be the answer — and 聞く needs sentences
 * a kana has none of. They count 0, which the deck page and its options
 * already read as "not possible here".
 */
function waysFor(key, row) {
  if (isKanaDeck(key)) return { choose: row.cards, listen: 0, speak: 0, type: 0, flip: row.cards };
  return { choose: row.cards, listen: row.listen ?? 0, speak: row.cards, type: row.type ?? 0, flip: row.cards };
}

/** The three ways of saying a moment, one set per time zone. */
const whenFormatters = new Map();

function whenFormat(timeZone) {
  let f = whenFormatters.get(timeZone);
  if (!f) {
    f = {
      // German since v75 (Henning, 2026-09-15: every control in German).
      // The container's Node has full ICU: "Do", "30. Okt." measured there.
      time: new Intl.DateTimeFormat("de-DE", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
      weekday: new Intl.DateTimeFormat("de-DE", { timeZone, weekday: "short" }),
      date: new Intl.DateTimeFormat("de-DE", { timeZone, day: "numeric", month: "short" }),
    };
    whenFormatters.set(timeZone, f);
  }
  return f;
}

/**
 * "morgen 06:00" — when a moment falls, said the way design 10 says it, on
 * the clock of the device that asked (#122). Today and tomorrow by name, the
 * rest of the week by weekday, anything later by date.
 */
export function whenOnClock(at, now, timeZone = DEFAULT_TIME_ZONE) {
  const f = whenFormat(timeZone);
  const today = dayIn(now, timeZone);
  const day = dayIn(at, timeZone);
  let label;
  if (day === today) label = "heute";
  else if (day === nextDay(today)) label = "morgen";
  else if (at - now < 6 * DAY) label = f.weekday.format(at * 1000);
  else label = f.date.format(at * 1000);
  return `${label} ${f.time.format(at * 1000)}`;
}

/**
 * What the practise tab's nothing-due block needs to say (design 10; #90, #91).
 *
 *   ahead    cards due within two days — the "Practise ahead" count
 *   lapsed   cards missed in the last three days — "Recent mistakes"
 *   nextDue  `{ count, at, when }`: when the next card falls due, and how many
 *            fall due that same day — "28 · tomorrow 06:00"
 *
 * The two counts come from `queueForUser` itself, so an offer can never
 * promise a number its session then does not deliver. `nextDue` counts only
 * cards the scheduler has seen: new cards are not "due", they are allowed, and
 * the allowance is a different sentence.
 */
export function outlookForUser(db, userId, now = Math.floor(Date.now() / 1000), { deckKey, deck, list, timeZone = DEFAULT_TIME_ZONE } = {}) {
  // Within the deck or list she practises in (#137), like the queue it stands
  // in for: an offer counted over every card would promise a session of cards
  // her lines never show.
  const ahead = queueForUser(db, userId, { deckKey, deck, list, only: "ahead", timeZone }, now).available;
  const lapsed = queueForUser(db, userId, { deckKey, deck, list, only: "lapsed", timeZone }, now).available;
  // Cards she has never seen, past the day's allowance (#179). `only: "new"` is
  // a set she chose, so the daily limit does not apply to it — that is what
  // makes this an offer rather than a promise the queue would break.
  const fresh = queueForUser(db, userId, { deckKey, deck, list, only: "new", timeZone }, now).available;

  const visible = visibleTo(userId);
  const scope = [];
  const scheduled = `FROM card_state s JOIN cards c ON c.id = s.card_id
     WHERE s.user_id = ? AND c.deleted_at IS NULL AND ${visible.sql}${filterClause({ deckKey, deck, list }, scope, userId)}`;
  const { at } = db.prepare(`SELECT min(s.due_at) AS at ${scheduled} AND s.due_at > ?`).get(userId, ...visible.params, ...scope, now);

  let nextDue = null;
  if (at) {
    const endOfThatDay = startOfDay(nextDay(dayIn(at, timeZone)), timeZone);
    const { n } = db
      .prepare(`SELECT count(*) AS n ${scheduled} AND s.due_at > ? AND s.due_at < ?`)
      .get(userId, ...visible.params, ...scope, now, endOfThatDay);
    nextDue = { count: n, at, when: whenOnClock(at, now, timeZone) };
  }

  return { ahead, lapsed, fresh, nextDue };
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

/** Databases that already know `search_romaji()`; registered on first use. */
const romajiReady = new WeakSet();

function withSearchRomaji(db) {
  if (romajiReady.has(db)) return;
  db.function("search_romaji", { deterministic: true }, (word, reading) => searchRomaji(word, reading));
  romajiReady.add(db);
}

/**
 * §5a's browse screen: search by Japanese or by English gloss, filter by deck
 * and tag, and see what is starred.
 */
export function browseCards(db, userId, { q, deck, tag, starred, page = 0, pageSize = 50 } = {}) {
  // Join parameters and filter parameters are kept apart deliberately: mixing
  // them is how a query ends up reading a user id as a search term.
  // A card she deleted leaves every list, but its row stays for the event log
  // to point at (migration 004). Someone else's own words were never on it
  // (#84).
  const visible = visibleTo(userId);
  const whereParams = [...visible.params];
  // Search finds words (#158): a kana card is a letter, and "ka" would bring
  // か and カ up among the Kaishi words, opening a topics sheet for a letter.
  let where = `WHERE c.deleted_at IS NULL AND c.deck NOT IN ('hiragana', 'katakana') AND ${visible.sql}`;
  let romajiKey;

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
    //
    // v69: and by its romaji, through the very function the phone searches
    // with offline (`searchRomaji`), so the two cannot find different cards.
    // Matched where a word starts, as the gloss is, and a card that is exactly
    // the search comes first (`exactFirst` in browse.js).
    romajiKey = romajiQuery(q);
    if (romajiKey) withSearchRomaji(db);
    where +=
      " AND (c.word LIKE ? OR c.word_reading LIKE ? OR c.word_furigana LIKE ? OR " +
      `${normalisedGloss("c.word_meaning")} LIKE ?` +
      (romajiKey ? " OR instr(search_romaji(c.word, c.word_reading), ?) > 0" : "") +
      ")";
    whereParams.push(`%${q}%`, `%${q}%`, `%${q}%`, `% ${q.toLowerCase()}%`, ...(romajiKey ? [` ${romajiKey}`] : []));
  }
  if (deck) {
    where += " AND c.deck = ?";
    whereParams.push(deck);
  }
  if (tag) {
    // Hers count too — see filterClause above.
    where +=
      " AND (EXISTS (SELECT 1 FROM tags t WHERE t.card_id = c.id AND t.tag = ?)" +
      " OR EXISTS (SELECT 1 FROM card_user_tags ut" +
      " WHERE ut.card_id = c.id AND ut.user_id = ? AND ut.tag = ?))";
    whereParams.push(tag, userId, tag);
  }
  if (starred) {
    where +=
      " AND EXISTS (SELECT 1 FROM card_stars s2 WHERE s2.card_id = c.id AND s2.user_id = ? AND s2.starred = 1)";
    whereParams.push(userId);
  }

  const size = Math.min(Math.max(pageSize, 1), 200);
  const offset = Math.max(page, 0) * size;
  const exactFirst = romajiKey ? "instr(search_romaji(c.word, c.word_reading), ?) = 0, " : "";

  const cards = db
    .prepare(
      `SELECT c.id, c.word, c.word_furigana, c.word_reading, c.word_meaning, c.word_audio,
              c.deck, c.frequency_rank, c.deck_id, d.name AS deck_name,
              COALESCE(st.starred, 0) AS starred,
              s.due_at, s.reps, s.last_review
         FROM cards c
         LEFT JOIN card_stars st ON st.card_id = c.id AND st.user_id = ?
         LEFT JOIN card_state  s ON s.card_id  = c.id AND s.user_id  = ?
         -- Which of her decks a card of hers is in, for Search's label (#137).
         LEFT JOIN decks d ON d.id = c.deck_id
         ${where}
        ORDER BY ${exactFirst}c.frequency_rank IS NULL, c.frequency_rank ASC, c.id ASC
        LIMIT ? OFFSET ?`,
    )
    .all(userId, userId, ...whereParams, ...(romajiKey ? [` ${romajiKey}|`] : []), size, offset)
    .map((r) => ({ ...r, starred: Boolean(r.starred) }));

  // Both halves of a card's topics, per row (#35): the deck's, which she
  // cannot change, and hers, which she can. One query each for the whole page
  // rather than joins, because a card carries several of each and two joins
  // would multiply the rows out.
  //
  // The deck's are sent even though the client has them on the cached card:
  // browse rows are built from this response alone, and a sheet that showed
  // only her topics would make an already-tagged card look untagged — which
  // is an invitation to coin a duplicate of a name that is already there.
  const ids = cards.map((c) => c.id);
  const mine = userTagsFor(db, userId, ids);
  const deckTags = new Map();
  if (ids.length > 0) {
    for (const { card_id, tag } of db
      .prepare(
        `SELECT card_id, tag FROM tags
          WHERE card_id IN (${ids.map(() => "?").join(",")}) ORDER BY tag ASC`,
      )
      .all(...ids)) {
      if (!deckTags.has(card_id)) deckTags.set(card_id, []);
      deckTags.get(card_id).push(tag);
    }
  }
  for (const card of cards) {
    card.tags = deckTags.get(card.id) ?? [];
    card.myTags = mine.get(card.id) ?? [];
  }

  const { n: total } = db
    .prepare(`SELECT count(*) n FROM cards c ${where}`)
    .get(...whereParams);

  return { page, pageSize: size, total, cards };
}

/**
 * Set or clear a star (#22 and #35).
 *
 * A last-write-wins register, not an insert-or-delete: the row stays once a
 * card has been touched, and a write only takes effect if `changedAt` is at
 * least as new as what is already stored. That `>=` (not `>`) is what makes
 * sending the same star twice — a retried offline action, most often — safe:
 * the second write changes nothing rather than racing the first.
 *
 * `changedAt` defaults to now for the handful of internal/test callers that
 * do not carry one; the route always passes the client's own timestamp,
 * because *that* is the moment the tap actually happened, not whenever the
 * request happens to arrive.
 */
export function setStar(db, userId, cardId, starred, changedAt = Math.floor(Date.now() / 1000)) {
  if (!visibleCard(db, userId, cardId)) return { ok: false, reason: "unknown_card" };

  db.prepare(
    `INSERT INTO card_stars (user_id, card_id, starred, changed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, card_id) DO UPDATE SET
       starred = excluded.starred,
       changed_at = excluded.changed_at
     WHERE excluded.changed_at >= card_stars.changed_at`,
  ).run(userId, cardId, starred ? 1 : 0, changedAt);

  const row = db
    .prepare("SELECT starred FROM card_stars WHERE user_id = ? AND card_id = ?")
    .get(userId, cardId);
  return { ok: true, cardId, starred: Boolean(row.starred) };
}

/**
 * Which of these card ids the user has starred (#35).
 *
 * Answered for a given set rather than "all her stars" because the callers all
 * have a set in hand — a session's queue — and the whole list would be an
 * unbounded thing to send in order to colour twenty buttons.
 */
export function starredAmong(db, userId, cardIds) {
  if (!cardIds?.length) return [];
  const holes = cardIds.map(() => "?").join(",");
  return db
    .prepare(`SELECT card_id FROM card_stars WHERE user_id = ? AND starred = 1 AND card_id IN (${holes})`)
    .all(userId, ...cardIds)
    .map((r) => r.card_id);
}
