import { randomUUID } from "node:crypto";
import { MAX_RESHOWS, comesRoundAgain, labelsAfter, reshowPosition, returnsAfter, takeDue } from "../../client/src/reshow.js";
import { formatInterval } from "../../client/src/screens/session.js";
import { deckSettings } from "../src/deck-settings.js";
import { dayIn, nextDay, startOfDay } from "../src/day.js";
import { ingestEvents } from "../src/events.js";
import { MAX_SESSION_LENGTH, parseDeckKey, queueForUser } from "../src/queue.js";
import { runPush, subscribe } from "../src/push.js";
import { replayCardState } from "../src/replay.js";
import { previewAfterAgain, previewAfterStep, previewIntervals } from "../src/scheduler.js";

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
  // A new word missed as often as in Charlotte's first days (37 % Nochmal in
  // "100 vokabeln", measured 2026-09-19), a word met before far less often —
  // the other profiles miss every card alike, which overstates the backlog.
  realistisch: { again: 0.37, againSeen: 0.12, hard: 0.1, easy: 0.05, skip: [] },
};

/**
 * Two sessions a day, local time: a morning one in 選ぶ (two answers) and an
 * evening one in めくる (four) — so both kinds of rating row are exercised.
 */
export const DEFAULT_SESSIONS = [
  { hour: 8, mode: "choose" },
  { hour: 19, mode: "flip" },
];

/**
 * How she might actually use it (Henning, 2026-09-19: "Du musst die Nutzung
 * simulieren"). Each is a function of the day and the seeded randomness,
 * returning that day's sessions: `hour`, `minute`, `mode`, and `stopAfter` —
 * the answers after which she puts the phone away, whatever is left.
 */
export const PATTERNS = {
  zweimal: () => DEFAULT_SESSIONS,
  "einmal-abends": () => [{ hour: 20, mode: "flip" }],
  // Two sessions a few minutes apart — what an app that says "your next
  // cards are ready" (Noji) brings about.
  "gleich-nochmal": () => [{ hour: 19, mode: "flip" }, { hour: 19, minute: 30, mode: "flip" }],
  // Short bursts on the train: twenty cards at most, three times a day.
  pendeln: () => [
    { hour: 7, minute: 40, mode: "choose", stopAfter: 20 },
    { hour: 12, minute: 30, mode: "flip", stopAfter: 20 },
    { hour: 17, minute: 50, mode: "flip", stopAfter: 20 },
  ],
  // A day in three off; one to three sessions at any hour from 7 to 22, of
  // ten to forty answers.
  unregelmaessig: (day, random) => {
    if (random() < 0.3) return [];
    const count = 1 + Math.floor(random() * 3);
    const hours = new Set();
    while (hours.size < count) hours.add(7 + Math.floor(random() * 16));
    return [...hours]
      .sort((a, b) => a - b)
      .map((hour) => ({ hour, minute: Math.floor(random() * 60), mode: random() < 0.5 ? "choose" : "flip", stopAfter: 10 + Math.floor(random() * 31) }));
  },
};

function answer(profile, mode, random, reshown, fresh) {
  const base = fresh ? profile.again : (profile.againSeen ?? profile.again);
  const again = reshown ? base / 2 : base;
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

export async function simulate(db, userId, {
  deckKey = "kaishi",
  days = 30,
  start,
  timeZone = "Asia/Tokyo",
  profile = PROFILES.fleissig,
  sessions = DEFAULT_SESSIONS,
  pattern,
  // #248: `{ reacts, delay }` — she is subscribed; a notification makes her
  // open the app `delay` seconds later with probability `reacts`.
  push,
  seed = 1,
} = {}) {
  const pushTimes = [];
  if (push) subscribe(db, userId, { endpoint: `https://push.invalid/sim-${userId}`, keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) } }, timeZone);
  const random = seeded(seed);
  // A separate stream for the pattern, so choosing one does not change the
  // answers a learner gives.
  const usage = seeded(seed + 1000);
  // Every card shown, in order: what she experienced (`experience` below).
  const showings = [];
  const { newPerDay, maxPerDay } = deckSettings(db, userId, deckKey);
  // The deck as the queue scopes it: Kaishi and the kana decks by `deck`,
  // one of her own by `deck_id` as well (`deck:1`).
  const scope = parseDeckKey(deckKey);
  const inDeck = scope.deckId === undefined ? "c.deck = ?" : "c.deck = ? AND c.deck_id = ?";
  const deckParams = scope.deckId === undefined ? [scope.deck] : [scope.deck, scope.deckId];
  const countToday = db.prepare(
    `SELECT count(DISTINCT e.card_id) n FROM review_events e JOIN cards c ON c.id = e.card_id
      WHERE e.user_id = ? AND e.reviewed_at >= ? AND ${inDeck}`,
  );

  const lastEvent = db.prepare(
    "SELECT rating, reviewed_at FROM review_events WHERE user_id = ? AND card_id = ? ORDER BY reviewed_at DESC, id DESC LIMIT 1",
  );
  const stateOf = db.prepare("SELECT * FROM card_state WHERE user_id = ? AND card_id = ?");
  const deckCards = db
    .prepare(
      `SELECT c.id, c.frequency_rank FROM cards c
        WHERE c.deleted_at IS NULL AND ${inDeck} AND (c.deck <> 'personal' OR c.owner_id = ?)
        ORDER BY c.frequency_rank IS NULL, c.frequency_rank ASC, c.id ASC`,
    )
    .all(...deckParams, userId);
  // A deck key the lookup above does not understand finds no cards, and every
  // check below then passes by checking nothing — which is what `deck:1`
  // did before this scope existed.
  if (deckCards.length === 0) throw new Error(`no cards in deck ${deckKey}`);
  const historyOf = db.prepare("SELECT id, rating, reviewed_at FROM review_events WHERE user_id = ? AND card_id = ?");

  const violations = [];
  const rows = [];
  const seenEver = new Set(db.prepare("SELECT DISTINCT card_id FROM review_events WHERE user_id = ?").all(userId).map((r) => r.card_id));

  let dayKey = start ?? dayIn(Math.floor(Date.now() / 1000), timeZone);
  for (let d = 1; d <= days; d++, dayKey = nextDay(dayKey)) {
    // fresh: first seen today · reviews: seen before · again: Nochmal answers ·
    // reshown: came round again in the same session · deferred: owed but left
    // for tomorrow by a full last session · early/late/labelOff: violations.
    const row = { day: d, date: dayKey, pushes: 0, fromPush: 0, sessions: 0, fresh: 0, reviews: 0, again: 0, reshown: 0, deferred: 0, early: 0, late: 0, labelOff: 0 };
    rows.push(row);
    if (profile.skip.includes(d)) continue;

    const dayStart = startOfDay(dayKey, timeZone);
    let busyUntil = 0;
    let lastFull = false;
    const today = [...(pattern ? pattern(d, usage) : sessions)];
    if (today.length === 0) continue;
    for (let sessionNo = 0; sessionNo < today.length; sessionNo++) {
      const { hour, minute = 0, mode, stopAfter = Infinity, fromPush = false } = today[sessionNo];
      // A session cannot start before the last one ended: sixty cards with
      // their Nochmal and learning steps can outlast a half-hour gap.
      const now = Math.max(dayStart + hour * HOUR + minute * 60, busyUntil + 60);
      row.sessions += 1;
      const where = `Tag ${d} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const session = `${d}/${sessionNo}`;

      const q = queueForUser(db, userId, { deckKey, timeZone }, now, random);
      const inQueue = new Set(q.cardIds);
      if (inQueue.size !== q.cardIds.length) violations.push(`${where}: eine Karte steht zweimal in der Übung`);
      if (q.cardIds.length > MAX_SESSION_LENGTH) violations.push(`${where}: ${q.cardIds.length} Karten, mehr als ${MAX_SESSION_LENGTH}`);
      // Full: the session cap (60), or the deck's "Max cards per day"
      // (migration 017) used up by this session — either way the queue had
      // to leave owed cards for later, and says nothing about the label.
      const answeredToday = countToday.get(userId, dayStart, ...deckParams).n;
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

      // The labels a phone would print under the buttons: folded at session
      // start, as the queue route does (`intervalsForCards`) — before any
      // answer, and after a Nochmal (#242).
      const labels = new Map();
      const againLabels = new Map();
      const stepLabels = new Map();
      for (const id of q.cardIds) {
        const history = historyOf.all(userId, id);
        labels.set(id, previewIntervals(history, new Date(now * 1000)));
        againLabels.set(id, [1, 2, 3].map((times) => previewAfterAgain(history, new Date(now * 1000), times)));
        const steps = {};
        for (const r of [2, 3]) {
          const wait = labels.get(id)[r];
          if (wait < DAY) steps[r] = previewAfterStep(history, new Date(now * 1000), r, wait);
        }
        stepLabels.set(id, steps);
      }
      const labelSource = new Map();
      const labelFor = (id) => {
        const source = labelSource.has(id) ? labelSource.get(id) : "first";
        if (source === "first") return labels.get(id);
        if (source === "again") return againLabels.get(id)[(reshows.get(id) ?? 1) - 1];
        if (source?.startsWith("step:")) return stepLabels.get(id)[source.slice(5)];
        return undefined;
      };

      // ── the session itself: Nochmal three cards on, a learning step
      // (Schwer 8, Gut 15 minutes) when its time has come — the app's rules
      // from reshow.js, on the simulated clock.
      const queue = [...q.cardIds];
      const reshows = new Map();
      const waiting = [];
      const shown = new Set();
      const lastInSession = new Map();
      let t = now;
      let i = 0;
      for (; i < stopAfter; i++) {
        const due = takeDue(waiting, t);
        if (due) queue.splice(i, 0, due.id);
        if (i >= queue.length) break;
        const id = queue[i];
        const reshown = shown.has(id);
        shown.add(id);
        const fresh = !seenEver.has(id);
        t += SECONDS_PER_ANSWER;
        const rating = answer(profile, mode, random, reshown, fresh);
        const said = labelFor(id);
        showings.push({ id, t, rating, fresh, reshown, session, label: said?.[rating] });
        if (fresh) {
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
        // Not checked where the app shows no label (after Schwer or Gut).
        if (said) {
          const promised = formatInterval(said[rating]);
          const actual = formatInterval(stateOf.get(userId, id).due_at - t);
          if (promised !== actual) {
            row.labelOff += 1;
            violations.push(`${where}: Karte ${id}, Bewertung ${rating}: Knopf sagte „${promised}“, geplant sind „${actual}“`);
          }
        }

        if (comesRoundAgain(rating, reshows.get(id) ?? 0)) {
          queue.splice(reshowPosition(i, queue.length), 0, id);
          reshows.set(id, (reshows.get(id) ?? 0) + 1);
        }
        const back = returnsAfter(rating, said?.[rating]);
        if (back !== undefined) waiting.push({ id, at: t + back });
        labelSource.set(id, labelsAfter(rating, labelSource.has(id) ? labelSource.get(id) : "first"));
        lastInSession.set(id, rating);
      }

      busyUntil = t;

      // #248: after the session, the server's minute-by-minute check, until
      // her next planned session or the end of the day. When it sends, she
      // opens the app a few minutes later — or, `push.reacts` of the time
      // not, she does not.
      if (push) {
        const next = today[sessionNo + 1];
        const nextAt = next ? dayStart + next.hour * HOUR + (next.minute ?? 0) * 60 : dayStart + DAY - 60;
        for (let m = t + 60; m < nextAt; m += 60) {
          const r = await runPush(db, m, async () => "ok");
          if (r.sent === 0) continue;
          row.pushes += 1;
          pushTimes.push(m);
          if (usage() < push.reacts) {
            const opensAt = m + push.delay;
            const local = opensAt - dayStart;
            today.splice(sessionNo + 1, 0, {
              hour: Math.floor(local / HOUR),
              minute: Math.floor((local % HOUR) / 60),
              mode: "flip",
              fromPush: true,
            });
            row.fromPush += 1;
          }
          break;
        }
      }

      // She put the phone away with cards left: the day's new words may be
      // among them, and a Nochmal card may not have come round yet.
      const stoppedEarly = i < queue.length;
      if (stoppedEarly) lastFull = true;

      // ── gleich nochmal: a card leaves the session on a Nochmal only once
      // it has come round the most times the rule allows (#214).
      for (const [id, rating] of stoppedEarly ? [] : lastInSession) {
        if (rating === 1 && (reshows.get(id) ?? 0) < MAX_RESHOWS) {
          violations.push(`${where}: Karte ${id} endete mit Nochmal und kam nicht wieder`);
        }
      }
    }

    // ── neue Wörter jeden Tag: exactly the deck's daily number, however many
    // sessions — fewer only when the day's last session was full of cards
    // already owed (§5 puts those first), or the deck has run out.
    const unseenLeft = deckCards.filter((c) => !seenEver.has(c.id)).length;
    if (row.fresh > newPerDay) violations.push(`Tag ${d}: ${row.fresh} neue Wörter, mehr als ${newPerDay}`);
    else if (row.fresh < newPerDay && !lastFull && unseenLeft > 0) {
      violations.push(`Tag ${d}: nur ${row.fresh} neue Wörter statt ${newPerDay}`);
    }
  }

  return { rows, violations, newPerDay, maxPerDay, showings, pushTimes };
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

function median(values) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * What the learner lived through, from `simulate`'s showings: after each
 * answer, how long until she actually saw that card again — against what the
 * button said. The label is a promise about when a card is *due*; this is
 * when it *came*, which depends on when she next opened the app.
 */
export function experience(showings) {
  const next = new Map();
  const gaps = [];
  for (let i = showings.length - 1; i >= 0; i--) {
    const s = showings[i];
    const after = next.get(s.id);
    gaps[i] = after ? { gap: after.t - s.t, sameSession: after.session === s.session } : undefined;
    next.set(s.id, s);
  }

  const groups = {};
  const firstDays = new Map(); // id → showings within 24 hours of its first
  const introduced = new Map();
  showings.forEach((s, i) => {
    if (s.fresh) introduced.set(s.id, s.t);
    const first = introduced.get(s.id);
    if (first !== undefined && s.t - first < DAY) firstDays.set(s.id, (firstDays.get(s.id) ?? 0) + 1);
    if (s.reshown || s.label === undefined || !gaps[i]) return;
    const key = `${s.fresh ? "neu" : "gesehen"}:${s.rating}`;
    const g = (groups[key] ??= { labels: [], gaps: [], sameSession: 0 });
    g.labels.push(s.label);
    g.gaps.push(gaps[i].gap);
    if (gaps[i].sameSession) g.sameSession += 1;
  });

  const summary = {};
  for (const [key, g] of Object.entries(groups)) {
    summary[key] = {
      label: formatInterval(median(g.labels)),
      answers: g.gaps.length,
      median: formatInterval(median(g.gaps)),
      sameSession: Math.round((100 * g.sameSession) / g.gaps.length),
      withinDay: Math.round((100 * g.gaps.filter((x) => x < DAY).length) / g.gaps.length),
    };
  }
  const seenOnFirstDay = [...firstDays.values()];
  return {
    ratings: summary,
    // How many times a new word is shown in its first 24 hours.
    firstDay: {
      median: median(seenOnFirstDay),
      once: Math.round((100 * seenOnFirstDay.filter((n) => n === 1).length) / (seenOnFirstDay.length || 1)),
    },
  };
}
