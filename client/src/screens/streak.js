import { WEEKDAYS, calendarWeeks, dayKind, dayOfMonth } from "../history.js";
import { el, num } from "../ui/dom.js";

/**
 * The streak, after the session that made today count (#273).
 *
 * Charlotte sent Noji's screen (#271): a flame and "1 Tag Streak", the week
 * Monday to Sunday under it with the frozen days drawn as ice, and
 * "Fortfahren". Henning, 2026-09-24: everything it does should be here, in
 * the same order, so that someone who knows Noji finds it — not necessarily
 * Noji's symbols. What stands in for Noji's share button is the way to the
 * Stats tab, where the whole calendar is. Our streak freeze is the joker;
 * a day a joker covered is drawn as Noji draws a frozen one.
 *
 * Nothing here computes the streak (§8a): it draws what `/api/stats` says.
 */

/**
 * Whether this session is the one that made today count: fewer answers than
 * a streak day needs before it, enough after. Once a day, the way Noji shows
 * its screen when the streak grows. Without both snapshots — offline, or a
 * stats answer that came late — it is not shown rather than guessed at.
 */
export function madeTodayCount(before, after) {
  if (!before || !after) return false;
  const perDay = after.reviewsPerQualifyingDay;
  if (!perDay || !(after.streak > 0)) return false;
  return (before.reviewsToday ?? 0) < perDay && (after.reviewsToday ?? 0) >= perDay;
}

/** A YYYY-MM-DD `n` days after `day`, in the same calendar (history.js reads days as UTC). */
function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * This week, Monday to Sunday, from the server's history (Monday six weeks
 * back through today). Days after today have no entry there; they are drawn
 * with their date and nothing else, as in Noji.
 */
export function streakWeek(history, perDay) {
  if (!history?.length) return [];
  const today = history.at(-1).day;
  const week = calendarWeeks(history.map((d) => ({ ...d }))).at(-1);
  let last = today;
  return week.map((entry) => {
    if (!entry) {
      last = addDays(last, 1);
      return { day: last, kind: "future", today: false };
    }
    return { day: entry.day, kind: dayKind(entry, perDay), today: entry.day === today };
  });
}

export const streakWords = (n) => (n === 1 ? "Tag Serie" : "Tage Serie");

/** Noji's outlined flame. The path is Lucide's "flame" (ISC licence). */
function flame() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("streak-flame");
  const path = document.createElementNS(ns, "path");
  path.setAttribute(
    "d",
    "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  );
  svg.append(path);
  return svg;
}

export function streakScreen({ stats, onContinue, onStats }) {
  const perDay = stats.reviewsPerQualifyingDay;
  const week = streakWeek(stats.history, perDay);
  const jokers = stats.jokers ?? 0;
  return el(
    "div.streak-screen",
    { role: "dialog", "aria-label": `${num(stats.streak)} ${streakWords(stats.streak)}` },
    el(
      "div.streak-body",
      {},
      el("div.streak-count", {}, flame(), el("span.streak-number.tabular", { text: num(stats.streak) })),
      el("span.streak-words", { text: streakWords(stats.streak) }),
      el(
        "div.streak-week",
        { role: "list", "aria-label": "Diese Woche" },
        WEEKDAYS.map((w, i) => {
          const d = week[i];
          const label =
            !d || d.kind === "future"
              ? ""
              : d.kind === "joker"
                ? ", Joker"
                : d.kind === "counted"
                  ? ", gezählt"
                  : d.kind === "some"
                    ? ", geübt"
                    : "";
          return el(
            "div.streak-weekday",
            { role: "listitem", "aria-label": d ? `${w} ${dayOfMonth(d.day)}${label}` : w },
            el("span.streak-weekday-name", { text: w }),
            d
              ? el(`span.streak-day.${d.kind}`, { class: d.today ? "today" : undefined, text: String(dayOfMonth(d.day)) })
              : null,
          );
        }),
      ),
      el("p.streak-note", {
        text:
          jokers > 0
            ? `${num(jokers)} Joker übrig – ${jokers === 1 ? "er rettet" : "jeder rettet"} einen Tag, an dem du nicht übst.`
            : "Keine Joker übrig. Fünf Tage am Stück bringen einen neuen.",
      }),
    ),
    el(
      "div.streak-actions",
      {},
      el("button.btn-primary.streak-continue", { type: "button", text: "Fortfahren", onclick: () => onContinue?.() }),
      el("button.streak-stats", { type: "button", text: "Statistik", onclick: () => onStats?.() }),
    ),
  );
}
