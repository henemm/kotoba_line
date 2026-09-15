import { modeByKey } from "./modes.js";

/**
 * Her learning history (#98): the calendar on the Stats tab and one card's
 * own record. The words and the layout arithmetic, kept apart from the DOM so
 * they can be tested.
 *
 * Every day here is a YYYY-MM-DD string the server worked out in her zone
 * (§8a, #122). Nothing in this file asks the phone's clock what day it is:
 * a weekday is read off the date itself, as UTC, which cannot shift it.
 */

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const WEEKDAY_OF_UTC = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
// Without the abbreviation's full stop: the date often ends a sentence, and
// "Sep.." is what the stop gave there.
const MONTHS = ["Jan", "Feb", "März", "Apr", "Mai", "Juni", "Juli", "Aug", "Sep", "Okt", "Nov", "Dez"];

function parts(day) {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d, weekday: WEEKDAY_OF_UTC[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}

/** "Mo, 14. Sep." — with the year only when it is not this one. */
export function dayLabel(day, today) {
  const { y, m, d, weekday } = parts(day);
  const year = today && parts(today).y !== y ? ` ${y}` : "";
  return `${weekday}, ${d}. ${MONTHS[m - 1]}${year}`;
}

/** "Heute", "Gestern", or the date. */
export function relativeDayLabel(day, today, yesterday) {
  if (day === today) return "Heute";
  if (day === yesterday) return "Gestern";
  return dayLabel(day, today);
}

/** The day of the month, for a calendar cell. */
export const dayOfMonth = (day) => parts(day).d;

/**
 * The server's list of days — Monday first, today last — as rows of seven.
 * The days after today in the current week are `null`, so the last row still
 * has seven cells and the columns stay under their weekday.
 */
export function calendarWeeks(history) {
  const weeks = [];
  for (let i = 0; i < history.length; i += 7) weeks.push(history.slice(i, i + 7));
  const last = weeks.at(-1);
  if (last) while (last.length < 7) last.push(null);
  return weeks;
}

/**
 * How a calendar day is drawn. A day with reviews under the ten a streak
 * needs is still a day she practised, but it is drawn apart from one that
 * counted — otherwise the calendar would show a practised week beside a
 * streak of zero and look wrong.
 */
export function dayKind({ reviews, joker }, perDay) {
  if (reviews >= perDay) return "counted";
  if (reviews > 0) return "some";
  if (joker) return "joker";
  return "none";
}

const reviewsText = (n) => `${n} ${n === 1 ? "Wiederholung" : "Wiederholungen"}`;

/** The line under the calendar for the day she tapped. */
export function dayDetail(entry, perDay, today, yesterday) {
  const when = relativeDayLabel(entry.day, today, yesterday);
  switch (dayKind(entry, perDay)) {
    case "counted":
      return `${when}: ${reviewsText(entry.reviews)}. Der Tag zählt für deine Serie.`;
    case "some":
      return entry.day === today
        ? `${when}: ${reviewsText(entry.reviews)}. Ab ${perDay} zählt der Tag für deine Serie.`
        : `${when}: ${reviewsText(entry.reviews)}. Für die Serie zählt ein Tag ab ${perDay}.`;
    case "joker":
      return `${when}: nicht geübt. Ein Joker hat den Tag abgedeckt.`;
    default:
      return entry.day === today ? `${when}: noch nichts wiederholt.` : `${when}: nicht geübt.`;
  }
}

/** Days in the calendar she practised at all. */
export const daysPractised = (history) => history.filter((d) => d.reviews > 0).length;

/**
 * What an answer was, in the words the session buttons use. めくる's "Gut" is
 * the same rating as "Gewusst" in the other modes, and here, out of the
 * session, the plainer word is the one that explains it.
 */
export function ratingLabel(rating) {
  return { 1: "Nicht gewusst", 2: "Schwer", 3: "Gewusst", 4: "Leicht" }[rating] ?? "";
}

export const modeLabel = (key) => modeByKey(key)?.en ?? key;

/** The two lines above a card's list of reviews. */
export function cardRecordSummary({ events, dueDay, today }) {
  if (events.length === 0) return { count: "Noch nie geübt.", due: null };
  const missed = events.filter((e) => e.rating === 1).length;
  const count =
    `${events.length}-mal geübt` +
    (missed > 0 ? `, ${missed}-mal nicht gewusst` : "") +
    `. Zuerst am ${dayLabel(events.at(-1).day, today)}.`;
  const due = !dueDay ? null : dueDay <= today ? "Jetzt wieder dran." : `Wieder dran am ${dayLabel(dueDay, today)}.`;
  return { count, due };
}
