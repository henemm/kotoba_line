import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { madeTodayCount, streakWeek, streakWords } from "../src/screens/streak.js";

/** #273: Noji's streak screen after the session that made today count. */

describe("madeTodayCount (#273)", () => {
  const stats = (reviewsToday, streak = 3) => ({ reviewsToday, streak, reviewsPerQualifyingDay: 10 });

  it("is true for the session that took today to ten, once", () => {
    assert.equal(madeTodayCount(stats(4), stats(12)), true);
    assert.equal(madeTodayCount(stats(0), stats(10)), true);
  });

  it("is false for the sessions after it, and for one that stays short", () => {
    assert.equal(madeTodayCount(stats(12), stats(30)), false, "today already counted");
    assert.equal(madeTodayCount(stats(2), stats(7)), false);
  });

  it("is false without both answers — offline it is not guessed at", () => {
    assert.equal(madeTodayCount(undefined, stats(12)), false);
    assert.equal(madeTodayCount(stats(4), undefined), false);
    assert.equal(madeTodayCount(stats(4), stats(12, 0)), false, "no streak to show");
  });
});

describe("streakWeek (#273)", () => {
  // Monday 21 to Thursday 24 September 2026 as the tail of the server's history.
  const history = [
    ...Array.from({ length: 14 }, (_, i) => ({ day: `2026-09-${String(7 + i).padStart(2, "0")}`, reviews: 0, joker: false })),
    { day: "2026-09-21", reviews: 0, joker: true },
    { day: "2026-09-22", reviews: 0, joker: true },
    { day: "2026-09-23", reviews: 3, joker: false },
    { day: "2026-09-24", reviews: 200, joker: false },
  ];

  it("draws this week Monday to Sunday, the days to come with their dates", () => {
    const week = streakWeek(history, 10);
    assert.deepEqual(
      week.map((d) => [d.day.slice(8), d.kind, d.today]),
      [
        ["21", "joker", false],
        ["22", "joker", false],
        ["23", "some", false],
        ["24", "counted", true],
        ["25", "future", false],
        ["26", "future", false],
        ["27", "future", false],
      ],
    );
  });

  it("crosses a month's end for the days to come", () => {
    const week = streakWeek([{ day: "2026-09-28", reviews: 12, joker: false }, { day: "2026-09-29", reviews: 12, joker: false }, { day: "2026-09-30", reviews: 12, joker: false }], 10);
    assert.deepEqual(week.slice(3).map((d) => d.day), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  });

  it("says Tag or Tage", () => {
    assert.equal(streakWords(1), "Tag Serie");
    assert.equal(streakWords(5), "Tage Serie");
  });
});
