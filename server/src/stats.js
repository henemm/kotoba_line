/**
 * XP, levels, streak and jokers (§8a).
 *
 * All of it derived from review_events. Nothing is stored as a counter, so the
 * two devices cannot disagree about her progress and a wrong number is fixed by
 * replaying the log rather than by patching a row.
 */

/** §8a: correct 10, wrong 3, and +15 the first time a new card is answered right. */
const XP_CORRECT = 10;
const XP_WRONG = 3;
const XP_FIRST_CORRECT = 15;

/** §8a: a day counts towards the streak once it carries this many reviews. */
export const REVIEWS_PER_QUALIFYING_DAY = 10;

/** §8a: one joker every five consecutive qualifying days, three at most. */
const DAYS_PER_JOKER = 5;
const MAX_JOKERS = 3;

/** Rating 1 is "again". Everything above it was a successful recall (§6). */
const isCorrect = (rating) => rating >= 2;

/**
 * The day an event belongs to, fixed to Asia/Tokyo (§8a).
 *
 * Not device-local and not UTC: a streak that resets because a phone changed
 * timezone is the kind of bug that ends the habit. `en-CA` formats as
 * YYYY-MM-DD, which sorts and compares as a string.
 */
const tokyoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function tokyoDay(unixSeconds) {
  return tokyoFormatter.format(new Date(unixSeconds * 1000));
}

/** Step a YYYY-MM-DD string forward one day, staying in that calendar. */
export function nextDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * XP from the whole event log.
 *
 * "First-time correct on a new card" means the card's earliest event, so the
 * bonus is a property of the log rather than of when the server saw it — an
 * event arriving late from a second device still lands on the right card.
 */
export function xpFromEvents(events) {
  const firstEventByCard = new Map();
  for (const e of events) {
    const seen = firstEventByCard.get(e.card_id);
    if (!seen || e.reviewed_at < seen.reviewed_at || (e.reviewed_at === seen.reviewed_at && e.id < seen.id)) {
      firstEventByCard.set(e.card_id, e);
    }
  }

  let xp = 0;
  for (const e of events) {
    xp += isCorrect(e.rating) ? XP_CORRECT : XP_WRONG;
    if (isCorrect(e.rating) && firstEventByCard.get(e.card_id) === e) {
      xp += XP_FIRST_CORRECT;
    }
  }
  return xp;
}

/**
 * §8a: "level n starts at 100 * n * (n + 1) / 2 XP (100, 300, 600, 1000,
 * 1500, ...)". Taken literally, so level 7 starts at 2,800 and level 23 at
 * 27,600 — which is what the Stats designs draw.
 *
 * The one adjustment: the formula puts everything under 100 XP on level 0, and
 * no screen draws a level 0. Level 1 therefore absorbs the range below level
 * 2's threshold, so a beginner starts on 1 and levels to 2 at 300 XP. Every
 * level from 2 upward is exactly where §8a puts it.
 *
 * The day-one design says "100 XP to level 2", which is off by one threshold
 * against the spec and against its own sibling screens. Recorded in
 * design/next-brief.md.
 */
export function levelThreshold(level) {
  return (100 * level * (level + 1)) / 2;
}

export function levelForXp(xp) {
  if (xp < levelThreshold(2)) return 1;
  let level = 2;
  while (levelThreshold(level + 1) <= xp) level += 1;
  return level;
}

/** The XP at which the user's current level began; 0 while still on level 1. */
export function levelFloor(level) {
  return level === 1 ? 0 : levelThreshold(level);
}

/**
 * Walk the calendar from her first review to today, awarding and spending
 * jokers as §8a describes.
 *
 * Today never breaks the streak: the day is not over, and a streak that
 * collapses at midnight Tokyo time because she has not practised *yet* would
 * be wrong every morning.
 *
 * The streak counts **days practised, not days elapsed**. A joker keeps the run
 * alive across a gap; it does not invent a day of study. Five days practised,
 * one covered, one practised is a streak of six. §8a does not settle this, and
 * the honest reading is the one where the number never claims work that did not
 * happen.
 */
export function streakFromDays(qualifyingDays, today) {
  const qualifying = new Set(qualifyingDays);
  if (qualifying.size === 0) {
    return { current: 0, longest: 0, jokers: 0, jokerSpentOn: undefined, gapDays: 0 };
  }

  const sorted = [...qualifying].sort();
  let current = 0;
  let longest = 0;
  let jokers = 0;
  let consecutive = 0;
  let jokerSpentOn;
  let gapDays = 0;

  for (let day = sorted[0]; day <= today; day = nextDay(day)) {
    if (qualifying.has(day)) {
      current += 1;
      consecutive += 1;
      if (consecutive % DAYS_PER_JOKER === 0 && jokers < MAX_JOKERS) jokers += 1;
      if (current > longest) longest = current;
      continue;
    }

    // The day is still running; judge it tomorrow.
    if (day === today) continue;

    if (jokers > 0) {
      jokers -= 1;
      jokerSpentOn = day;
      gapDays += 1;
      continue;
    }

    // §8a: with no joker in hand the streak resets. Unspent jokers survive it,
    // and the five-day counter starts again.
    current = 0;
    consecutive = 0;
    jokerSpentOn = undefined;
    gapDays = 0;
  }

  return { current, longest, jokers, jokerSpentOn, gapDays };
}

/**
 * Maturity bands for the Stats screen, by the interval the scheduler last
 * chose. The Anki convention: under a day is still being learned, under three
 * weeks is young, beyond that is mature.
 */
export function maturityBand(state) {
  if (!state || state.reps === 0) return "new";
  const intervalDays = (state.due_at - (state.last_review ?? state.due_at)) / 86400;
  if (intervalDays < 1) return "learning";
  if (intervalDays < 21) return "young";
  return "mature";
}

/**
 * Everything `GET /api/stats` returns. One pass over the user's events plus a
 * couple of aggregate queries — at a few hundred thousand rows this is well
 * under a millisecond, and it cannot drift.
 */
export function statsForUser(db, userId, now = Math.floor(Date.now() / 1000)) {
  const events = db
    .prepare(
      `SELECT id, card_id, rating, reviewed_at
         FROM review_events WHERE user_id = ?
        ORDER BY reviewed_at, id`,
    )
    .all(userId);

  const xp = xpFromEvents(events);
  const level = levelForXp(xp);

  const reviewsPerDay = new Map();
  for (const e of events) {
    const day = tokyoDay(e.reviewed_at);
    reviewsPerDay.set(day, (reviewsPerDay.get(day) ?? 0) + 1);
  }
  const qualifyingDays = [...reviewsPerDay]
    .filter(([, n]) => n >= REVIEWS_PER_QUALIFYING_DAY)
    .map(([day]) => day);

  const streak = streakFromDays(qualifyingDays, tokyoDay(now));

  const states = db
    .prepare("SELECT card_id, due_at, last_review, reps FROM card_state WHERE user_id = ?")
    .all(userId);

  const maturity = { new: 0, learning: 0, young: 0, mature: 0 };
  for (const state of states) maturity[maturityBand(state)] += 1;

  const seenCardIds = new Set(events.map((e) => e.card_id));
  // A card with events but no scheduler row yet still counts as new.
  maturity.new += [...seenCardIds].filter(
    (id) => !states.some((s) => s.card_id === id),
  ).length;

  // The deck's topics and hers, in one list (#35).
  //
  // Unioned rather than kept apart, because this list drives two things that
  // both want every topic: the picker she filters a session with, and the
  // per-topic progress bars. A topic she invented is one she wants to practise
  // and to see progress on.
  //
  // `own` marks which side a name came from, so a screen that wants to group
  // them still can. A name on both sides — she puts a card into `food` — is one
  // row whose cards are the union, and `own` is true, because the fact worth
  // surfacing is that she has touched it.
  const topics = db
    .prepare(
      `WITH all_tags AS (
         SELECT tag, card_id, 0 AS own FROM tags
         UNION
         SELECT tag, card_id, 1 AS own FROM card_user_tags WHERE user_id = ?
       )
       SELECT a.tag                                       AS tag,
              count(DISTINCT a.card_id)                   AS total,
              count(DISTINCT CASE WHEN e.card_id IS NOT NULL
                                  THEN a.card_id END)     AS seen,
              max(a.own)                                  AS own
         FROM all_tags a
         JOIN cards c ON c.id = a.card_id AND c.deleted_at IS NULL
         LEFT JOIN review_events e
                ON e.card_id = a.card_id AND e.user_id = ?
        GROUP BY a.tag
        ORDER BY a.tag`,
    )
    .all(userId, userId)
    .map((t) => ({ ...t, own: Boolean(t.own) }));

  return {
    xp,
    level,
    xpForLevel: levelFloor(level),
    xpForNextLevel: levelThreshold(level + 1),
    streak: streak.current,
    longestStreak: streak.longest,
    jokers: streak.jokers,
    jokerSpentOn: streak.jokerSpentOn ?? null,
    daysCoveredByJokers: streak.gapDays,
    reviewsToday: reviewsPerDay.get(tokyoDay(now)) ?? 0,
    reviewsPerQualifyingDay: REVIEWS_PER_QUALIFYING_DAY,
    cardsSeen: seenCardIds.size,
    maturity,
    topics,
  };
}
