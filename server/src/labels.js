import { dayIn, nextDay, startOfDay } from "./day.js";
import { previewAfterAgain, previewAfterStep, previewIntervals } from "./scheduler.js";

/**
 * The four intervals for each card, folded from its own history.
 *
 * One query for every card's events rather than one per card: a sixty-card
 * めくる session would otherwise be sixty round trips through SQLite for a
 * number printed under a button.
 *
 * Its own module so that the usage simulation (test/simulate-days.js) prints
 * the very labels the queue route sends.
 *
 * #246: they hold for today, on the device's calendar. A card's intervals
 * depend on how many days have passed since she last saw it, so the same
 * card answered after midnight gets a longer one than the button said at
 * session start — and a queue cached for a train can be a day old. So the
 * first-showing intervals come twice, for today and for tomorrow, with the
 * moments each day ends (`labelDays`); the client picks by its clock
 * (client/src/reshow.js, `labelsAt`) and prints nothing past the second.
 */
export function intervalsForCards(db, userId, cardIds, timeZone, now = new Date()) {
  const placeholders = cardIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, card_id, rating, reviewed_at, time_zone
         FROM review_events
        WHERE user_id = ? AND card_id IN (${placeholders})`,
    )
    .all(userId, ...cardIds);

  const byCard = new Map(cardIds.map((id) => [id, []]));
  for (const row of rows) byCard.get(row.card_id)?.push(row);

  const today = dayIn(Math.floor(now.getTime() / 1000), timeZone);
  const labelDays = [startOfDay(nextDay(today), timeZone), startOfDay(nextDay(nextDay(today)), timeZone)];
  const tomorrow = new Date(labelDays[0] * 1000);

  const intervals = {};
  const intervalsTomorrow = {};
  const againIntervals = {};
  const stepIntervals = {};
  for (const id of cardIds) {
    const events = byCard.get(id);
    intervals[id] = previewIntervals(events, now, timeZone);
    intervalsTomorrow[id] = previewIntervals(events, tomorrow, timeZone);
    // Back after Schwer or Gut on its first showing, once that step is up.
    const steps = {};
    for (const rating of [2, 3]) {
      const wait = intervals[id][rating];
      if (wait < 86400) steps[rating] = previewAfterStep(events, now, rating, wait, timeZone);
    }
    stepIntervals[id] = steps;
    // After one, two and three Nochmal in a row — a session brings a card
    // round at most three times (client/src/reshow.js, MAX_RESHOWS).
    againIntervals[id] = [1, 2, 3].map((times) => previewAfterAgain(events, now, times, timeZone));
  }
  return { intervals, intervalsTomorrow, labelDays, againIntervals, stepIntervals };
}
