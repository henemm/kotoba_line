import { randomUUID } from "node:crypto";
import { MAX_RESHOWS, comesRoundAgain } from "../../client/src/reshow.js";
import { formatInterval } from "../../client/src/screens/session.js";
import { deckSettings } from "../src/deck-settings.js";
import { dayIn, nextDay, startOfDay } from "../src/day.js";
import { ingestEvents } from "../src/events.js";
import { MAX_SESSION_LENGTH, queueForUser } from "../src/queue.js";
import { replayCardState } from "../src/replay.js";
import { previewIntervals } from "../src/scheduler.js";

/**
 * Days of practice, simulated (#242).
 *
 * A learner opens a deck at set times on consecutive days, answers every card
 * the server hands her, and the answers go through the same path a phone's
 * outbox does (`ingestEvents`). Nothing waits: every server function takes
 * `now`, and FSRS runs without fuzz (rule 2), so thirty days take a second
 * and two runs with the same seed produce the same log.
 *
 * What a session does on the phone and the server never sees — a Nochmal
 * card coming round again at the end (#214) — is `comesRoundAgain`, the
 * client's own rule, not a copy of it. Each reshow is a real event, and so
 * it changes what the following days look like.
 *
 * After every session the simulation checks what Henning asked for
 * (2026-09-19): new words keep coming, and a card comes back when the label
 * under the button said it would — not before, not after. That promise is
 * re-derived here from `card_state` rather than read back from the queue's
 * own SQL, so a bug in the SQL shows up as a disagreement.
 */

const DAY = 86400;
const HOUR = 3600;
/** §5: a Nochmal within three days keeps a card in every session. */
const LAPSE_WINDOW = 3 * DAY;
/** How long one answer takes, give or take. Only the order of events matters. */
const SECONDS_PER_ANSWER = 20;

/** A seeded source of randomness (mulberry32), so a run can be repeated exactly. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How a learner answers. `again` is the chance of Nochmal (Nicht gewusst) on
 * a first showing; on a card coming round again it is halved — she has just
 * seen the answer. In めくる (`flip`) she also uses Schwer and Leicht; the
 * other modes only have two answers (§6).
 */
export const PROFILES = {
  fleissig: { again: 0.2, hard: 0.1, easy: 0.1, skip: [] },
  schwach: { again: 0.4, hard: 0.15, easy: 0.02, skip: [] },
  // Days are 1-based: three days away in the middle of the month.
  luecke: { again: 0.2, hard: 0.1, easy: 0.1, skip: [10, 11, 12] },
};

/**
 * Two sessions a day, local time: a morning one in 選ぶ (two answers) and an
 * evening one in めくる (four) — so both kinds of rating row are exercised.
 */
export const DEFAULT_SESSIONS = [
  { hour: 8, mode: "choose" },
  { hour: 19, mode: "flip" },
];

function answer(profile, mode, random, reshown) {
  const again = reshown ? profile.again / 2 : profile.again;
  const r = random();
  if (r < again) return 1;
  if (mode !== "flip") return 3;
  if (r < again + profile.hard) return 2;
  if (r < again + profile.hard + profile.easy) return 4;
  return 3;
}

/**
 * Whether the label under the button promised this card for `now` — the
 * independent oracle. A card whose last interval was a day or more is due
 * the whole calendar day its date falls on (#215); a learning step (1, 6, 10
 * minutes) is due at its minute.
 */
export function promisedBy(state, now, timeZone) {
  const interval = state.due_at - (state.last_review ?? state.due_at);
  if (interval >= DAY) return dayIn(state.due_at, timeZone) <= dayIn(now, timeZone);
  return state.due_at <= now;
}

export function simulate(db, userId, {
  deckKey = "kaishi",
  days = 30,
  start,
  timeZone = "Asia/Tokyo",
  profile = PROFILES.fleissig,
  sessions = DEFAULT_SESSIONS,
  seed = 1,
} = {}) {
  const random = seeded(seed);
  const { newPerDay, maxPerDay } = deckSettings(db, userId, deckKey);
  const countToday = db.prepare(
    `SELECT count(DISTINCT e.card_id) n FROM review_events e JOIN cards c ON c.id = e.card_id
      WHERE e.user_id = ? AND e.reviewed_at >= ? AND c.deck = ?`,
  );

  const lastEvent = db.prepare(
    "SELECT rating, reviewed_at FROM review_events WHERE user_id = ? AND card_id = ? ORDER BY reviewed_at DESC, id DESC LIMIT 1",
  );
  const stateOf = db.prepare("SELECT * FROM card_state WHERE user_id = ? AND card_id = ?");
  const deckCards = db
    .prepare(
      `SELECT c.id, c.frequency_rank FROM cards c
        WHERE c.deleted_at IS NULL AND c.deck = ? AND (c.deck <> 'personal' OR c.owner_id = ?)
        ORDER BY c.frequency_rank IS NULL, c.frequency_rank ASC, c.id ASC`,
    )
    .all(deckKey, userId);
  const historyOf = db.prepare("SELECT id, rating, reviewed_at FROM review_events WHERE user_id = ? AND card_id = ?");

  const violations = [];
  const rows = [];
  const seenEver = new Set(db.prepare("SELECT DISTINCT card_id FROM review_events WHERE user_id = ?").all(userId).map((r) => r.card_id));

  let dayKey = start ?? dayIn(Math.floor(Date.now() / 1000), timeZone);
  for (let d = 1; d <= days; d++, dayKey = nextDay(dayKey)) {
    // fresh: first seen today · reviews: seen before · again: Nochmal answers ·
    // reshown: came round again in the same session · deferred: owed but left
    // for tomorrow by a full last session · early/late/labelOff: violations.
    const row = { day: d, date: dayKey, sessions: 0, fresh: 0, reviews: 0, again: 0, reshown: 0, deferred: 0, early: 0, late: 0, labelOff: 0 };
    rows.push(row);
    if (profile.skip.includes(d)) continue;

    const dayStart = startOfDay(dayKey, timeZone);
    let lastFull = false;
    for (const { hour, mode } of sessions) {
      const now = dayStart + hour * HOUR;
      row.sessions += 1;
      const where = `Tag ${d} ${String(hour).padStart(2, "0")}:00`;

      const q = queueForUser(db, userId, { deckKey, timeZone }, now, random);
      const inQueue = new Set(q.cardIds);
      if (inQueue.size !== q.cardIds.length) violations.push(`${where}: eine Karte steht zweimal in der Übung`);
      if (q.cardIds.length > MAX_SESSION_LENGTH) violations.push(`${where}: ${q.cardIds.length} Karten, mehr als ${MAX_SESSION_LENGTH}`);
      // Full: the session cap (60), or the deck's "Max cards per day"
      // (migration 017) used up by this session — either way the queue had
      // to leave owed cards for later, and says nothing about the label.
      const answeredToday = countToday.get(userId, dayStart, deckKey).n;
      const capped =
        q.cardIds.length >= MAX_SESSION_LENGTH ||
        (maxPerDay != null && answeredToday + q.cardIds.length >= maxPerDay);
      lastFull = capped;

      // ── nicht zu früh: every card already seen must be due by its label,
      // or its last answer was Nochmal within three days.
      for (const id of q.cardIds) {
        const state = stateOf.get(userId, id);
        if (!state) continue;
        if (promisedBy(state, now, timeZone)) continue;
        const last = lastEvent.get(userId, id);
        if (last.rating === 1 && last.reviewed_at >= now - LAPSE_WINDOW) continue;
        row.early += 1;
        violations.push(`${where}: Karte ${id} kommt vor ihrer Angabe (fällig ${new Date(state.due_at * 1000).toISOString()})`);
      }

      // ── nicht zu spät: every card whose label has come due, and every
      // recent Nochmal, is in this session — unless the session is full.
      // `deferred` ends the day as what the last session had to leave out.
      row.deferred = 0;
      for (const { id } of deckCards) {
        if (inQueue.has(id)) continue;
        const state = stateOf.get(userId, id);
        if (!state) continue;
        const last = lastEvent.get(userId, id);
        const owed = promisedBy(state, now, timeZone) || (last.rating === 1 && last.reviewed_at >= now - LAPSE_WINDOW);
        if (!owed) continue;
        if (capped) {
          row.deferred += 1;
          continue;
        }
        row.late += 1;
        violations.push(`${where}: Karte ${id} ist fällig und fehlt in der Übung`);
      }

      // ── neue Wörter in der Reihenfolge der Häufigkeit: none of the unseen
      // cards left out may be more frequent than one that was let in.
      const freshIds = q.cardIds.filter((id) => !seenEver.has(id));
      const unseen = deckCards.filter((c) => !seenEver.has(c.id));
      const rankOf = new Map(unseen.map((c, i) => [c.id, i]));
      const worstIn = Math.max(-1, ...freshIds.map((id) => rankOf.get(id)));
      const skipped = unseen.slice(0, worstIn + 1).filter((c) => !inQueue.has(c.id));
      if (skipped.length > 0) violations.push(`${where}: ${skipped.length} häufigere neue Wörter übersprungen`);

      // The labels a phone would print under めくる's buttons: folded at
      // session start, as the queue route does (`intervalsForCards`).
      const labels = new Map();
      for (const id of q.cardIds) labels.set(id, previewIntervals(historyOf.all(userId, id), new Date(now * 1000)));

      // ── the session itself, including Nochmal coming round again.
      const queue = [...q.cardIds];
      const reshows = new Map();
      const lastInSession = new Map();
      let t = now;
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        const reshown = reshows.has(id);
        t += SECONDS_PER_ANSWER;
        const rating = answer(profile, mode, random, reshown);
        if (!seenEver.has(id)) {
          seenEver.add(id);
          row.fresh += 1;
        } else if (!reshown) row.reviews += 1;
        if (reshown) row.reshown += 1;
        if (rating === 1) row.again += 1;

        const { rejected } = ingestEvents(db, userId, [{ id: randomUUID(), card_id: id, mode, rating, reviewed_at: t }], t);
        if (rejected.length) violations.push(`${where}: Antwort auf Karte ${id} abgelehnt (${rejected[0].reason})`);

        // ── die Angabe unter dem Knopf: what 'Gut → 2 Tage' said is when the
        // card is now due. Compared as the button prints it, so exactly as
        // coarse as what she reads: "2 Tage" either side can hide hours.
        // Withheld on a reshown card (#214), so not checked.
        if (!reshown) {
          const promised = formatInterval(labels.get(id)[rating]);
          const actual = formatInterval(stateOf.get(userId, id).due_at - t);
          if (promised !== actual) {
            row.labelOff += 1;
            violations.push(`${where}: Karte ${id}, Bewertung ${rating}: Knopf sagte „${promised}“, geplant sind „${actual}“`);
          }
        }

        if (comesRoundAgain(rating, reshows.get(id) ?? 0)) {
          queue.push(id);
          reshows.set(id, (reshows.get(id) ?? 0) + 1);
        }
        lastInSession.set(id, rating);
      }

      // ── gleich nochmal: a card leaves the session on a Nochmal only once
      // it has come round the most times the rule allows (#214).
      for (const [id, rating] of lastInSession) {
        if (rating === 1 && (reshows.get(id) ?? 0) < MAX_RESHOWS) {
          violations.push(`${where}: Karte ${id} endete mit Nochmal und kam nicht wieder`);
        }
      }
    }

    // ── neue Wörter jeden Tag: exactly the deck's daily number, however many
    // sessions — fewer only when the day's last session was full of cards
    // already owed (§5 puts those first), or the deck has run out.
    const unseenLeft = deckCards.length - seenEver.size;
    if (row.fresh > newPerDay) violations.push(`Tag ${d}: ${row.fresh} neue Wörter, mehr als ${newPerDay}`);
    else if (row.fresh < newPerDay && !lastFull && unseenLeft > 0) {
      violations.push(`Tag ${d}: nur ${row.fresh} neue Wörter statt ${newPerDay}`);
    }
  }

  return { rows, violations, newPerDay, maxPerDay };
}

/** card_state as stored, then as folded from the log again: rule 1's promise. */
export function rebuildMatches(db, userId) {
  const read = () => db.prepare("SELECT * FROM card_state WHERE user_id = ? ORDER BY card_id").all(userId);
  const before = read();
  replayCardState(db, { userId });
  const after = read();
  return JSON.stringify(before) === JSON.stringify(after);
}

/** The whole event log in a form two runs can be compared by. */
export function logFingerprint(db, userId) {
  return db
    .prepare("SELECT card_id, mode, rating, reviewed_at FROM review_events WHERE user_id = ? ORDER BY reviewed_at, card_id")
    .all(userId)
    .map((e) => `${e.card_id}:${e.mode}:${e.rating}:${e.reviewed_at}`)
    .join("\n");
}
