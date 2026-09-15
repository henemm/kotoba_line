import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calendarWeeks,
  cardRecordSummary,
  dayDetail,
  dayKind,
  dayLabel,
  dayOfMonth,
  daysPractised,
  ratingLabel,
  relativeDayLabel,
} from "../src/history.js";

/**
 * #98. The words and the grid arithmetic only: how the calendar and the card
 * record look on a phone is checked in the browser (see the PR).
 */

const entry = (day, reviews = 0, joker = false) => ({ day, reviews, joker });

describe("the calendar's days (#98)", () => {
  it("reads the weekday off the date, whatever the phone's zone", () => {
    assert.equal(dayLabel("2026-09-14"), "Mo, 14. Sep");
    assert.equal(dayLabel("2026-03-01"), "So, 1. März");
    assert.equal(dayOfMonth("2026-09-07"), 7);
  });

  it("adds the year only for another year", () => {
    assert.equal(dayLabel("2026-12-31", "2026-12-31"), "Do, 31. Dez");
    assert.equal(dayLabel("2025-12-31", "2026-01-02"), "Mi, 31. Dez 2025");
  });

  it("says today and yesterday in words", () => {
    assert.equal(relativeDayLabel("2026-09-15", "2026-09-15", "2026-09-14"), "Heute");
    assert.equal(relativeDayLabel("2026-09-14", "2026-09-15", "2026-09-14"), "Gestern");
    assert.equal(relativeDayLabel("2026-09-13", "2026-09-15", "2026-09-14"), "So, 13. Sep");
  });

  it("lays the days out in weeks of seven, the rest of this week empty", () => {
    const days = Array.from({ length: 5 * 7 + 2 }, (_, i) => entry(`d${i}`));
    const weeks = calendarWeeks(days);
    assert.equal(weeks.length, 6);
    assert.ok(weeks.every((w) => w.length === 7));
    assert.deepEqual(weeks[5].slice(2), [null, null, null, null, null]);
    assert.equal(weeks[5][1].day, "d36");
    assert.deepEqual(calendarWeeks([]), []);
  });

  it("tells a day that counted for the streak from a shorter one", () => {
    assert.equal(dayKind(entry("x", 10), 10), "counted");
    assert.equal(dayKind(entry("x", 9), 10), "some");
    assert.equal(dayKind(entry("x", 0, true), 10), "joker");
    assert.equal(dayKind(entry("x", 0), 10), "none");
    assert.equal(daysPractised([entry("a", 3), entry("b", 0, true), entry("c", 12)]), 2);
  });

  it("describes the day she tapped", () => {
    const t = "2026-09-15";
    const y = "2026-09-14";
    assert.equal(dayDetail(entry(t, 42), 10, t, y), "Heute: 42 Wiederholungen. Der Tag zählt für deine Serie.");
    assert.equal(dayDetail(entry(t, 1), 10, t, y), "Heute: 1 Wiederholung. Ab 10 zählt der Tag für deine Serie.");
    assert.equal(dayDetail(entry(y, 7), 10, t, y), "Gestern: 7 Wiederholungen. Für die Serie zählt ein Tag ab 10.");
    assert.equal(dayDetail(entry("2026-09-09", 0, true), 10, t, y), "Mi, 9. Sep: nicht geübt. Ein Joker hat den Tag abgedeckt.");
    assert.equal(dayDetail(entry(t), 10, t, y), "Heute: noch nichts wiederholt.");
    assert.equal(dayDetail(entry("2026-09-08"), 10, t, y), "Di, 8. Sep: nicht geübt.");
  });
});

describe("a card's own record (#98)", () => {
  it("names each answer in the session's words", () => {
    assert.deepEqual([1, 2, 3, 4].map(ratingLabel), ["Nicht gewusst", "Schwer", "Gewusst", "Leicht"]);
  });

  it("says a card was never practised", () => {
    assert.deepEqual(cardRecordSummary({ events: [], dueDay: null, today: "2026-09-15" }), {
      count: "Noch nie geübt.",
      due: null,
    });
  });

  it("counts the answers and names the first day, which is the last in the list", () => {
    const events = [
      { day: "2026-09-14", mode: "flip", rating: 3 },
      { day: "2026-09-12", mode: "choose", rating: 1 },
      { day: "2026-09-10", mode: "choose", rating: 3 },
    ];
    const { count, due } = cardRecordSummary({ events, dueDay: "2026-09-20", today: "2026-09-15" });
    assert.equal(count, "3-mal geübt, 1-mal nicht gewusst. Zuerst am Do, 10. Sep.");
    assert.equal(due, "Wieder dran am So, 20. Sep.");
  });

  it("says a card due today or overdue is due now", () => {
    const events = [{ day: "2026-09-01", mode: "choose", rating: 3 }];
    assert.equal(cardRecordSummary({ events, dueDay: "2026-09-15", today: "2026-09-15" }).due, "Jetzt wieder dran.");
    assert.equal(cardRecordSummary({ events, dueDay: "2026-09-03", today: "2026-09-15" }).due, "Jetzt wieder dran.");
    assert.equal(cardRecordSummary({ events, dueDay: "2026-09-03", today: "2026-09-15" }).count, "1-mal geübt. Zuerst am Di, 1. Sep.");
  });
});
