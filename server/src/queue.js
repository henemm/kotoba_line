import { userTagsFor, visibleCard, visibleTo } from "./cards.js";
import { deckSettings } from "./deck-settings.js";
import { KANA_DECKS, MY_WORDS, TRAVEL_DECKS, isKanaDeck, ownDecks, travelDeck } from "./decks.js";
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

/**
 * §5: cards she got wrong in the last three days come back regardless of due
 * date — "wrong" meaning her *last* answer (#210). This used to read
 * `card_state.lapses > 0 AND last_review` within the window, and `lapses` is
 * FSRS's cumulative counter: one Nochmal made a card eligible for three days
 * however many Gut it earned after, because every one of those reviews
 * refreshed `last_review`. Measured in her log on 2026-09-18: four cards,
 * each with one lapse that morning, each rated Gut with "1 Tag" or "2 Tage"
 * on the button, each back within a minute in four sessions running.
 */
const LAPSE_WINDOW_DAYS = 3;

/**
 * The rating of a card's most recent review, in the order the scheduler folds
 * events (`orderEvents`: reviewed_at, then id). Correlated on the outer
 * query's `c.id`; the (user_id, card_id, reviewed_at) index serves it.
 */
const LAST_RATING_SQL = `(SELECT e.rating FROM review_events e
     WHERE e.user_id = s.user_id AND e.card_id = c.id
     ORDER BY e.reviewed_at DESC, e.id DESC LIMIT 1)`;

/**
 * §5a and phase-0-plan §3.1 D capped "All" at 60 so a backlog stayed
 * finishable. #242, Henning 2026-09-21: that cap is gone. It was a second,
 * invisible limit sitting on top of the deck's own "Maximal pro Tag" — which
 * is the one Noji has, and the one that belongs to her. Noji runs a session
 * until the day's cards are done, and the simulation measured what 60 cost:
 * with 40 % Nochmal the backlog filled the session, and because due cards
 * come before new ones (§5), no new word was introduced that day at all.
 *
 * What is left here is a bound on the size of one response, not a decision
 * about how long she practises: the queue is a JSON array of card ids and
 * every one of them is fetched. Nothing in her decks can reach it — the
 * whole Kaishi deck is 1,526 cards and a day's due count is two figures.
 */
export const MAX_SESSION_LENGTH = 500;

/** Design 10's "Practise ahead": cards due in the next two days (#90). */
const AHEAD_WINDOW_DAYS = 2;

export const ONLY_MODES = ["starred", "lapsed", "new", "ahead", "again"];

/** #271: the new cards "Nochmal" after a session mixes in — „ein paar neue". */
export const AGAIN_NEW = 5;

/**
 * §215: a card in review state — its last interval was a day or more, the
 * same `< 1` split `maturityBand` (stats.js) already draws between "learning"
 * and "young" — counts as due as soon as the calendar day `due_at` falls on
 * has begun, not at its exact clock time. Anki does the same: a card
 * scheduled two days out is due the whole day it lands on, not from one
 * moment on the clock. Without this, a card scheduled from an evening
 * session stays "not due" all the next morning and dumps the whole day's
 * cards on her at once in the afternoon — measured on Charlotte's log,
 * 2026-09-18 (#215).
 *
 * A card still inside a learning step (`< 1` day — FSRS's 1-minute and
 * 10-minute steps) stays exact: those are minutes, not days, and rounding
 * one up to a day boundary would offer it up to 20 hours before it is
 * actually due.
 *
 * `dayEnd` is the start of the day after `now`, so "its day has begun" is
 * `due_at < dayEnd`. `last_review` is always set once card_state exists in
 * practice — a row is only written after a first review (`stateFromEvents`,
 * scheduler.js) — but the column has no NOT NULL, so a NULL there would
 * otherwise make `>=` false and `NOT (...)` also false (SQL's three-valued
 * logic), matching *neither* branch and silently dropping the row from both
 * the queue and `nextDue`. The `COALESCE` reads that case as interval 0 —
 * exact-time, like `maturityBand` (stats.js) already treats it.
 */
const REVIEW_STATE_SQL = "s.due_at - COALESCE(s.last_review, s.due_at) >= ?";
const DUE_SQL = `((${REVIEW_STATE_SQL} AND s.due_at < ?) OR (NOT (${REVIEW_STATE_SQL}) AND s.due_at <= ?))`;
const NOT_DUE_SQL = `((${REVIEW_STATE_SQL} AND s.due_at >= ?) OR (NOT (${REVIEW_STATE_SQL}) AND s.due_at > ?))`;

/** Params for `DUE_SQL`/`NOT_DUE_SQL`, in the order their `?`s appear. */
function dueBoundaryParams(dayEnd, now) {
  return [DAY, dayEnd, DAY, now];
}

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
export const DECK_KEY_PATTERN = "^(kaishi|hiragana|katakana|travel:[12]|deck:[0-9]{1,15}|mine|list:.{1,100})$";

export function parseDeckKey(key) {
  // The kana decks (#158) are a `cards.deck` of their own, like Kaishi.
  if (key === "kaishi" || isKanaDeck(key)) return { deck: key };
  // #252: Reise 1 and 2 are Kaishi's cards under one topic.
  const travel = travelDeck(key);
  if (travel) return { deck: "kaishi", tag: travel.tag };
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
    sql += ` AND ${HOME_DECK} = ?`;
    params.push(scope.deck);
    if (scope.deckId !== undefined) {
      sql += " AND c.deck_id = ?";
      params.push(scope.deckId);
    }
    if (scope.deckName !== undefined) sql += byDeckName(scope.deckName, params, userId);
    if (scope.tag !== undefined) sql += byTag(scope.tag, params, userId);
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
  if (tag) sql += byTag(tag, params, userId);
  return sql;
}

/**
 * The deck a card is practised in (#284). A reverse of a Kaishi word is a
 * card of hers (`deck = 'personal'`, reverse.js) and is practised in Kaishi,
 * its original's deck — Reise 1 and 2 included, whose cards are Kaishi's.
 */
export const HOME_DECK = "coalesce((SELECT o.deck FROM cards o WHERE o.id = c.reverse_of), c.deck)";

function byTag(tag, params, userId) {
  params.push(tag, userId, tag);
  // A reverse's topics are its original's (#284): read from there, so a
  // topic the import gives a Kaishi word later is on its reverses too.
  return (
    " AND (EXISTS (SELECT 1 FROM tags t WHERE t.card_id = coalesce(c.reverse_of, c.id) AND t.tag = ?)" +
    " OR EXISTS (SELECT 1 FROM card_user_tags ut" +
    " WHERE ut.card_id = coalesce(c.reverse_of, c.id) AND ut.user_id = ? AND ut.tag = ?))"
  );
}

/**
 * The cards a deck's „Auch andersherum abfragen" switches (#284): its
 * originals that this account can see, the way the queue scopes the deck.
 */
export function deckCardIds(db, userId, deckKey) {
  const visible = visibleTo(userId);
  const params = [...visible.params];
  const sql = `SELECT c.id FROM cards c
    WHERE c.deleted_at IS NULL AND c.reverse_of IS NULL AND ${visible.sql} ${filterClause({ deckKey }, params, userId)}`;
  return db.prepare(sql).all(...params).map((r) => r.id);
}

/**
 * #284: a word and its reverse never in one session. The one met second is
 * answered by the one met first — measured live on 2026-09-24: 食べる came
 * due as "essen" and, two cards later, new as 食べる, with "essen" still on
 * screen a minute before. It happens on exactly the day a reverse is first
 * offered, since the original is then usually due too. So the reverse waits
 * for a day on which its original is not in the session, as Anki buries a
 * card's siblings. It stays due; nothing about its schedule changes.
 */
export function siblingsApart({ due, lapsed, fresh }, db) {
  const all = [...due, ...lapsed, ...fresh];
  const reverses = all.filter((id) => id < 0);
  if (reverses.length === 0) return { due, lapsed, fresh };
  const inQueue = new Set(all);
  const originalOf = new Map(
    db
      .prepare(`SELECT id, reverse_of FROM cards WHERE reverse_of IS NOT NULL AND id IN (${reverses.map(() => "?").join(",")})`)
      .all(...reverses)
      .map((r) => [r.id, r.reverse_of]),
  );
  const keep = (id) => !inQueue.has(originalOf.get(id));
  return { due: due.filter(keep), lapsed: lapsed.filter(keep), fresh: fresh.filter(keep) };
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
  const dayKey = dayIn(now, timeZone);
  // What she released for today on the deck page (#179, v90) is added to the
  // deck's own allowance, for that day only: the limit paces her, it does not
  // stop her. A release from another day counts for nothing.
  const releasedToday = ofDeck?.extraNewDay === dayKey ? ofDeck.extraNew : 0;
  const newPerDay =
    (ofDeck?.newPerDay ??
      (db.prepare("SELECT new_per_day FROM user_settings WHERE user_id = ?").get(userId)?.new_per_day ?? 15)) +
    releasedToday;

  // How many new cards were introduced today — in this deck, when there is
  // one — so the daily cap is a cap on the day rather than on the session.
  //
  // Today is the calendar day on her device, from its midnight (#122). It was
  // the last 24 hours, so ten new cards at 22:00 still used up ten of the next
  // morning's. One boundary for both halves: "first answered today" only means
  // that if "before today" is the same moment.
  const dayStart = startOfDay(dayKey, timeZone);
  // The day's other edge (§215): a review-state card is due once this moment
  // has passed.
  const dayEnd = startOfDay(nextDay(dayKey), timeZone);
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

  // #284: a reverse asks its original with the other side in front, which
  // only めくる has. In any other way of practising it would ask the
  // original's question a second time — 選ぶ already shows the Japanese and
  // asks for the German. Without a mode (the deck page's count) it counts,
  // as Noji counts it.
  const forwardOnly = mode != null && mode !== "flip" ? " AND c.reverse_of IS NULL" : "";

  const base = (extra, params) =>
    `SELECT c.id FROM cards c
      LEFT JOIN card_state s ON s.card_id = c.id AND s.user_id = ?
      ${starredOnly ? "JOIN card_stars st ON st.card_id = c.id AND st.user_id = ? AND st.starred = 1" : ""}
      WHERE c.deleted_at IS NULL AND ${visible.sql} ${filterClause({ deckKey, deck, list, tag }, params, userId)}${forwardOnly} ${extra}`;

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
    `AND s.card_id IS NOT NULL AND ${DUE_SQL}`,
    "ORDER BY s.due_at ASC",
    dueBoundaryParams(dayEnd, now),
  );

  // ── group 2: recently lapsed ────────────────────────────────────
  // Her last answer was Nochmal, within the window. Self-terminating: one
  // Gut takes the card out again, and then the button's promise holds.
  const lapsed = run(
    `AND s.card_id IS NOT NULL AND s.last_review >= ? AND ${LAST_RATING_SQL} = 1`,
    "ORDER BY s.last_review DESC",
    [now - LAPSE_WINDOW_DAYS * DAY],
  );

  // ── group 3: new ────────────────────────────────────────────────
  // §5a: a deliberately chosen session is never capped by the daily limit.
  const newAllowance = filtered ? limit : Math.max(0, newPerDay - introducedToday);
  // Asked for beyond the allowance, and cut to it only once `siblingsApart`
  // has taken out the reverses that wait for another day (#284): cut first,
  // every one of those took the place of a new card — measured on a copy of
  // her data with Kaishi both ways, めくる brought 22 cards and 選ぶ 30.
  const freshCandidates =
    newAllowance === 0
      ? []
      : run(
          // #284: a reverse is new only once its original is not — answered
          // on an earlier day of hers. Otherwise the two meet in one session
          // and the second is answered by the first, which she saw a minute
          // ago; and a word she has never met would arrive back to front.
          `AND s.card_id IS NULL AND (c.reverse_of IS NULL OR EXISTS (
             SELECT 1 FROM review_events e
              WHERE e.user_id = ? AND e.card_id = c.reverse_of AND e.reviewed_at < ?))`,
          // Personal cards have no rank; among them, ascending id — the order
          // of an imported list (#137), and newest first for words she added.
          // A reverse takes its original's place, right after it (#284).
          "ORDER BY c.frequency_rank IS NULL, c.frequency_rank ASC, coalesce(c.reverse_of, c.id) ASC, c.reverse_of IS NOT NULL LIMIT ?",
          [userId, dayStart, MAX_SESSION_LENGTH],
        );

  const apart = siblingsApart({ due, lapsed, fresh: freshCandidates }, db);
  const fresh = apart.fresh.slice(0, newAllowance);
  let groups = { due: apart.due, lapsed: apart.lapsed, fresh };

  // The day's maximum takes reviews first, then new cards, in the order the
  // session meets them — as Noji does. What it holds back is due tomorrow still.
  let maxReached = false;
  if (leftToday !== undefined) {
    // From `groups`, not the lists before `siblingsApart` (#284): taken from
    // those, a deck with a maximum put a word and its reverse back together.
    const reviews = [...new Set([...groups.due, ...groups.lapsed])];
    const kept = new Set(reviews.slice(0, leftToday));
    maxReached = leftToday === 0 && reviews.length + fresh.length > 0;
    groups = {
      due: groups.due.filter((id) => kept.has(id)),
      lapsed: groups.lapsed.filter((id) => kept.has(id)),
      fresh: fresh.slice(0, Math.max(0, leftToday - kept.size)),
    };
  }

  // §5a's `only=` narrows to one group rather than mixing.
  if (only === "again") {
    // #271: "Nochmal" after a session. Charlotte: „dann sollten nur die
    // Vokabeln kommen, die ich noch nicht kann, oder ein paar neue mit
    // eingefügt" — the cards she answered Nochmal or Schwer in the session
    // just finished (the client sends them as `cards`), whether or not the
    // scheduler has them due yet, and a few new ones from the same deck.
    // Only cards she can see and that are in the scope asked for.
    const asked = (opts.cards ?? []).slice(0, MAX_SESSION_LENGTH);
    const found = asked.length === 0 ? new Set() : new Set(run(`AND c.id IN (${asked.map(() => "?").join(",")})`, "", asked));
    groups = { due: asked.filter((id) => found.has(id)), lapsed: [], fresh: fresh.slice(0, AGAIN_NEW) };
  } else if (only === "lapsed") groups = { due: [], lapsed, fresh: [] };
  else if (only === "new") groups = { due: [], lapsed: [], fresh };
  else if (only === "ahead") {
    // #90: design 10 offers this when nothing is due, and it is what it says —
    // cards the scheduler will ask for within two days, soonest first. Anything
    // already due counts too: it is due within two days, and a device that
    // opened the tab a minute before a card fell due should not miss it.
    //
    // §215 deliberately left exact-time here, unlike DUE_SQL above: a rolling
    // 48-hour window, not "the next two calendar days". The gap this opens —
    // a review-state card due on day+2 after this moment's clock time (say,
    // 20:00 when `now` is 17:53) is not "ahead" yet, though day+2 has not even
    // started and the card will in fact be due at its very first minute — is
    // real but narrow: at most a few hours a day, only at the far edge of a
    // two-day preview, on a screen whose own copy already says "within two
    // days" rather than promising a precise cutoff. Switching this to the same
    // day-boundary rule as `due` would also change the number on design 10
    // for a case no one has reported, and would need `only=ahead`'s own tests
    // rewritten (#90) rather than merely read differently. Left for a
    // follow-up if it turns out to matter in practice.
    // A word and its reverse apart here too (#284).
    groups = siblingsApart(
      {
        due: run(
          "AND s.card_id IS NOT NULL AND s.due_at <= ?",
          "ORDER BY s.due_at ASC",
          [now + AHEAD_WINDOW_DAYS * DAY],
        ),
        lapsed: [],
        fresh: [],
      },
      db,
    );
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
 * When each card of a deck she has answered comes back (#274) — Noji's card
 * list says "Heute", "Morgen", "In 9 Tagen" above each card, and Charlotte
 * sent it to show what ours lacks.
 *
 * Card id → `{ band, days }`: the band as the deck page counts it, and the
 * calendar days from her today to the card's due day, 0 for today or
 * anything overdue. Calendar days on her device's clock (#122), the way
 * review cards fall due (#215) — a learning step due at 23:50 is "Heute",
 * one due at 00:10 is "Morgen". A card never answered has no entry: Noji
 * leaves those unlabelled too.
 */
export function deckDue(db, userId, deckKey, now = Math.floor(Date.now() / 1000), timeZone = DEFAULT_TIME_ZONE) {
  const params = [userId];
  const visible = visibleTo(userId);
  params.push(...visible.params);
  const sql = `SELECT c.id, s.due_at, s.last_review, s.reps FROM cards c
    JOIN card_state s ON s.card_id = c.id AND s.user_id = ?
    WHERE c.deleted_at IS NULL AND ${visible.sql} ${filterClause({ deckKey }, params, userId)}`;
  const today = Date.parse(`${dayIn(now, timeZone)}T00:00:00Z`);
  const due = {};
  for (const row of db.prepare(sql).all(...params)) {
    const days = Math.round((Date.parse(`${dayIn(row.due_at, timeZone)}T00:00:00Z`) - today) / 86400000);
    due[row.id] = { band: progressBand(row), days: Math.max(0, days) };
  }
  return due;
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
  const beginner = db.prepare("SELECT beginner FROM user_settings WHERE user_id = ?").get(userId)?.beginner === 1;
  if (beginner) return beginnerDecks(db, userId, now, timeZone);
  // What each way of practising can ask in this deck, the rule playableIn
  // (client/src/screens/session.js) applies card by card: 聞く needs a sentence
  // with a translation, 書く a reading. Counted so the deck's options can say
  // "not possible here" instead of opening a session with nothing in it.
  const count = db.prepare(
    `SELECT count(*) AS cards, count(s.card_id) AS seen,
            sum(c.sentence IS NOT NULL AND c.sentence_meaning IS NOT NULL) AS listen,
            sum(c.word_reading IS NOT NULL OR c.word_furigana IS NOT NULL) AS type
       FROM cards c LEFT JOIN card_state s ON s.card_id = c.id AND s.user_id = ?
      WHERE c.deleted_at IS NULL AND ${HOME_DECK} = ? AND (c.deck <> 'personal' OR c.owner_id = ?)
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
 * The deck list with Settings → Einstieg on (#252): Reise 1, then Reise 2 —
 * locked until every Reise 1 card has been said aloud and known once.
 *
 * 話す first: Henning's beginner reads the German, says it (with "Romaji
 * zeigen" if need be), records it, and turns the card to hear the native
 * recording beside the attempt. 選ぶ and めくる come with it — every card can
 * do both, and recognising a word is the easier step before producing it
 * (Henning, 2026-09-20). 書く and 聞く start off: typing Japanese is the
 * wrong first hurdle, and only 13 of Reise 1's 21 cards carry a sentence
 * with a translation, none of them the travel phrase itself.
 */
export function beginnerDecks(db, userId, now = Math.floor(Date.now() / 1000), timeZone = DEFAULT_TIME_ZONE) {
  const count = db.prepare(
    `SELECT count(*) AS cards, count(s.card_id) AS seen,
            sum(c.sentence IS NOT NULL AND c.sentence_meaning IS NOT NULL) AS listen,
            sum(c.word_reading IS NOT NULL OR c.word_furigana IS NOT NULL) AS type
       FROM cards c JOIN tags t ON t.card_id = c.id AND t.tag = ?
       LEFT JOIN card_state s ON s.card_id = c.id AND s.user_id = ?
      WHERE c.deleted_at IS NULL AND c.deck = 'kaishi'`,
  );
  let unlocked = true;
  return TRAVEL_DECKS.map(({ key, name, tag }) => {
    const row = count.get(tag, userId);
    const known = travelKnown(db, userId, tag);
    const deck = {
      key,
      own: false,
      name,
      cards: row.cards,
      seen: row.seen,
      known,
      // What the cards can do, as in any deck: which of them a Reise deck
      // *offers* is deck_settings' hiddenModes (deck-settings.js), so the
      // two it leaves out can still be switched on under Optionen.
      ways: waysFor(key, row),
      settings: deckSettings(db, userId, key),
    };
    const locked = !unlocked;
    // The next one waits for this one to be known throughout.
    unlocked = unlocked && row.cards > 0 && known >= row.cards;
    if (locked) return { ...deck, locked: true, today: { total: 0, fresh: 0, review: 0 } };
    return { ...deck, today: queueForUser(db, userId, { deckKey: key, timeZone }, now).today };
  });
}

/**
 * How many cards of a travel topic she has said and known at least once
 * (#252): a 話す answer of Gewusst. Read from the log, not kept anywhere
 * (rule 1) — and never lost again once earned, so a later Nochmal does not
 * lock Reise 2 behind her. "Romaji zeigen" grades Nochmal, so a card she
 * only read out does not count.
 */
export function travelKnown(db, userId, tag) {
  return db
    .prepare(
      `SELECT count(DISTINCT e.card_id) AS n
         FROM review_events e
         JOIN cards c ON c.id = e.card_id AND c.deleted_at IS NULL AND c.deck = 'kaishi'
         JOIN tags t ON t.card_id = c.id AND t.tag = ?
        WHERE e.user_id = ? AND e.mode = 'speak' AND e.rating > 1`,
    )
    .get(tag, userId).n;
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
 *
 * §215: `at` stays `due_at` as scheduled — the card's own clock time — even
 * though a review-state card is now offered from midnight on its day, hours
 * earlier. "morgen 06:00" is a conservative promise: she can in fact open it
 * any time after midnight, but that reads as "come back around six", not
 * "the queue rounds every card up to a full day, so check whenever" — a
 * sentence design 10 was never written to say. `dueDay` (stats.js,
 * `cardRecordSummary` in the client) already compares by calendar day rather
 * than clock time for the same reason `nextDue` cannot be reached before this
 * moment: that text only ever says "now" or a day, never a time.
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
  // §215: "not yet due" has to agree with the queue's own DUE_SQL, or a card
  // already sitting in today's session would still be announced here as
  // falling due some hours from now.
  const dayEnd = startOfDay(nextDay(dayIn(now, timeZone)), timeZone);
  const { at } = db
    .prepare(`SELECT min(s.due_at) AS at ${scheduled} AND ${NOT_DUE_SQL}`)
    .get(userId, ...visible.params, ...scope, ...dueBoundaryParams(dayEnd, now));

  let nextDue = null;
  if (at) {
    // Same complement as above: a review-state card due later today (`at`'s
    // day, when `at` itself is a same-day learning step) must not be counted
    // here too — it is already in `due`, not still waiting for `endOfThatDay`.
    const endOfThatDay = startOfDay(nextDay(dayIn(at, timeZone)), timeZone);
    const { n } = db
      .prepare(`SELECT count(*) AS n ${scheduled} AND ${NOT_DUE_SQL} AND s.due_at < ?`)
      .get(userId, ...visible.params, ...scope, ...dueBoundaryParams(dayEnd, now), endOfThatDay);
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
export function browseCards(db, userId, { q, id, deck, tag, starred, page = 0, pageSize = 50 } = {}) {
  // Join parameters and filter parameters are kept apart deliberately: mixing
  // them is how a query ends up reading a user id as a search term.
  // A card she deleted leaves every list, but its row stays for the event log
  // to point at (migration 004). Someone else's own words were never on it
  // (#84).
  const visible = visibleTo(userId);
  const whereParams = [...visible.params];
  // Search finds words (#158): a kana card is a letter, and "ka" would bring
  // か and カ up among the Kaishi words, opening a topics sheet for a letter.
  // A reverse (#284) is the same word again, and a word is listed once.
  let where = `WHERE c.deleted_at IS NULL AND c.reverse_of IS NULL AND c.deck NOT IN ('hiragana', 'katakana') AND ${visible.sql}`;
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
      // #134: seit die Kaishi-Bedeutung deutsch ist, liegt das Englische in
      // word_meaning_en. Ohne diese Zeile fände „to hit“ nichts mehr — die
      // Suche hätte einen Index verloren, den sie seit v69 hatte, und zwar
      // stillschweigend. Bei einer Karte ohne Übersetzung ist die Spalte
      // NULL, und NULL LIKE ? ist NULL, also kein Treffer: harmlos.
      ` OR ${normalisedGloss("c.word_meaning_en")} LIKE ?` +
      (romajiKey ? " OR instr(search_romaji(c.word, c.word_reading), ?) > 0" : "") +
      ")";
    whereParams.push(
      `%${q}%`, `%${q}%`, `%${q}%`, `% ${q.toLowerCase()}%`, `% ${q.toLowerCase()}%`,
      ...(romajiKey ? [` ${romajiKey}`] : []),
    );
  }
  // #302: the row Search would show for one card, for the sheet a deck
  // list opens — the list is the phone's copy and has no star or topics.
  if (id !== undefined) {
    where += " AND c.id = ?";
    whereParams.push(id);
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
              CASE WHEN c.word_audio_generated_for = c.word THEN c.word_audio_generated END AS word_audio_generated,
              c.deck, c.frequency_rank, c.deck_id, d.name AS deck_name,
              COALESCE(st.starred, 0) AS starred,
              s.due_at, s.reps, s.last_review,
              -- #284: whether this account asks it the other way round too,
              -- for the switch on the row's sheet.
              EXISTS (SELECT 1 FROM cards r WHERE r.reverse_of = c.id AND r.owner_id = ? AND r.deleted_at IS NULL) AS reverse
         FROM cards c
         LEFT JOIN card_stars st ON st.card_id = c.id AND st.user_id = ?
         LEFT JOIN card_state  s ON s.card_id  = c.id AND s.user_id  = ?
         -- Which of her decks a card of hers is in, for Search's label (#137).
         LEFT JOIN decks d ON d.id = c.deck_id
         ${where}
        ORDER BY ${exactFirst}c.frequency_rank IS NULL, c.frequency_rank ASC, c.id ASC
        LIMIT ? OFFSET ?`,
    )
    .all(userId, userId, userId, ...whereParams, ...(romajiKey ? [` ${romajiKey}|`] : []), size, offset)
    .map((r) => ({ ...r, starred: Boolean(r.starred), reverse: Boolean(r.reverse) }));

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

  // #284: a star is on the word, so on both of its directions — starred in a
  // session on the reverse, it shows on the word in her list and in Search.
  const word = db
    .prepare(
      `SELECT id FROM cards
        WHERE deleted_at IS NULL
          AND (id = (SELECT coalesce(reverse_of, id) FROM cards WHERE id = ?)
               OR (reverse_of = (SELECT coalesce(reverse_of, id) FROM cards WHERE id = ?) AND owner_id = ?))`,
    )
    .all(cardId, cardId, userId)
    .map((r) => r.id);
  const write = db.prepare(
    `INSERT INTO card_stars (user_id, card_id, starred, changed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, card_id) DO UPDATE SET
       starred = excluded.starred,
       changed_at = excluded.changed_at
     WHERE excluded.changed_at >= card_stars.changed_at`,
  );
  for (const id of new Set([cardId, ...word])) write.run(userId, id, starred ? 1 : 0, changedAt);

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
