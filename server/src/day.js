/**
 * Which day a moment belongs to — for the streak, the jokers, "reviews today",
 * the new cards a day allows and "tomorrow 06:00" (§8a).
 *
 * The day is the one on her device's clock face: midnight where she is (#122,
 * Henning, 2026-09-15). The device says which time zone it is in — an IANA
 * name like "Asia/Tokyo", sent as `X-Time-Zone` with every request
 * (client/src/api.js) — and the server still does the arithmetic, from the
 * event log's own timestamps. So the device contributes a zone, never a date.
 *
 * This replaces a day fixed to Asia/Tokyo. Where she is, that was the same
 * day; anywhere else it made the day start at 17:00.
 */

/**
 * For a request without the header — a phone still on a shell from before
 * #122 — the day it has always had.
 */
export const DEFAULT_TIME_ZONE = "Asia/Tokyo";

/** One formatter per zone: building them is the expensive part. */
const dayFormatters = new Map();

function dayFormatter(timeZone) {
  let f = dayFormatters.get(timeZone);
  if (!f) {
    // `en-CA` formats as YYYY-MM-DD, which sorts and compares as a string.
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(timeZone, f);
  }
  return f;
}

/**
 * A zone name the server can use, or the default. Anything `Intl` does not
 * know — a typo, an offset string, a header someone made up — is the default
 * rather than an error: a wrong day is recoverable, a practise tab that will
 * not load is not.
 *
 * An offset like "+09:00" is accepted, because `Intl` accepts it: a day with
 * no daylight saving, which is what it says. Browsers send names.
 */
export function validTimeZone(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 64) return DEFAULT_TIME_ZONE;
  if (dayFormatters.has(name)) return name;
  try {
    dayFormatter(name);
    return name;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** The zone a request's device is in. */
export function timeZoneOf(req) {
  return validTimeZone(req.headers["x-time-zone"]);
}

/** The day, as YYYY-MM-DD, that a moment falls on in that zone. */
export function dayIn(unixSeconds, timeZone = DEFAULT_TIME_ZONE) {
  return dayFormatter(timeZone).format(new Date(unixSeconds * 1000));
}

/** Step a YYYY-MM-DD string forward one day, staying in that calendar. */
export function nextDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

const clockFormatters = new Map();

/** How far the zone's clock is ahead of UTC at that moment, in seconds. */
function offsetAt(unixSeconds, timeZone) {
  let f = clockFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    clockFormatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(unixSeconds * 1000)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - unixSeconds;
}

/**
 * The first second of a YYYY-MM-DD day in that zone.
 *
 * Twice round, because the offset at midnight can differ from the offset at
 * the first guess on a day the clocks change. Where a change skips midnight
 * itself, the day starts at the first moment that is on it.
 */
export function startOfDay(day, timeZone = DEFAULT_TIME_ZONE) {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d) / 1000;
  let t = wall - offsetAt(wall, timeZone);
  t = wall - offsetAt(t, timeZone);
  if (dayIn(t, timeZone) < day) t += 3600;
  return t;
}
