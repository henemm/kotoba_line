import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  historyDays,
  levelFloor,
  levelForXp,
  levelThreshold,
  maturityBand,
  statsForUser,
  streakFromDays,
  xpFromEvents,
} from "../src/stats.js";
import { DEFAULT_TIME_ZONE, dayIn, nextDay, startOfDay, validTimeZone } from "../src/day.js";
import { ingestEvents } from "../src/events.js";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

const DAY = 86400;

describe("the day boundary is midnight in the device's zone (§8a, #122)", () => {
  it("puts late-evening UTC into the next Tokyo day", () => {
    // Tokyo is UTC+9, so 15:00Z is already midnight there.
    assert.equal(dayIn(Date.parse("2026-03-14T14:59:00Z") / 1000, "Asia/Tokyo"), "2026-03-14");
    assert.equal(dayIn(Date.parse("2026-03-14T15:00:00Z") / 1000, "Asia/Tokyo"), "2026-03-15");
  });

  it("is the same moment on a different day in another zone, not UTC's day", () => {
    // 23:00Z on the 14th: 08:00 on the 15th in Tokyo, midnight in Berlin.
    const t = Date.parse("2026-03-14T23:00:00Z") / 1000;
    assert.equal(dayIn(t, "Asia/Tokyo"), "2026-03-15");
    assert.equal(dayIn(t, "Europe/Berlin"), "2026-03-15");
    assert.equal(dayIn(t - 1, "Europe/Berlin"), "2026-03-14");
    assert.equal(dayIn(t, "UTC"), "2026-03-14");
  });

  it("starts a day at its midnight, across the clocks changing", () => {
    assert.equal(startOfDay("2026-03-15", "Asia/Tokyo"), Date.parse("2026-03-14T15:00:00Z") / 1000);
    assert.equal(startOfDay("2026-07-01", "Europe/Berlin"), Date.parse("2026-06-30T22:00:00Z") / 1000);
    // Berlin's clocks go forward at 02:00 on 29 March and back at 03:00 on 25 October.
    assert.equal(startOfDay("2026-03-29", "Europe/Berlin"), Date.parse("2026-03-28T23:00:00Z") / 1000);
    assert.equal(startOfDay("2026-03-30", "Europe/Berlin"), Date.parse("2026-03-29T22:00:00Z") / 1000);
    assert.equal(startOfDay("2026-10-26", "Europe/Berlin"), Date.parse("2026-10-25T23:00:00Z") / 1000);
    // Santiago skips from 00:00 to 01:00 on 6 September 2026: the day starts at 01:00.
    const santiago = startOfDay("2026-09-06", "America/Santiago");
    assert.equal(dayIn(santiago, "America/Santiago"), "2026-09-06");
    assert.equal(dayIn(santiago - 1, "America/Santiago"), "2026-09-05");
  });

  it("falls back to Tokyo for a zone it does not know", () => {
    assert.equal(validTimeZone("Europe/Berlin"), "Europe/Berlin");
    for (const bad of [undefined, "", "Not/AZone", "x".repeat(65), ["Asia/Tokyo"]]) {
      assert.equal(validTimeZone(bad), DEFAULT_TIME_ZONE);
    }
  });

  it("steps across a month and a leap day", () => {
    assert.equal(nextDay("2026-03-31"), "2026-04-01");
    assert.equal(nextDay("2026-12-31"), "2027-01-01");
    assert.equal(nextDay("2028-02-28"), "2028-02-29");
  });
});

describe("XP (§8a)", () => {
  const ev = (id, card_id, rating, reviewed_at) => ({ id, card_id, rating, reviewed_at });

  it("gives 10 for correct and 3 for wrong", () => {
    // Both are second sightings of their card, so no first-correct bonus.
    const events = [
      ev("a", 1, 3, 100), ev("b", 1, 3, 200),
      ev("c", 2, 1, 100), ev("d", 2, 1, 200),
    ];
    // card 1: 15 + 10 + 10 = first correct bonus + two correct
    // card 2: 3 + 3 = two wrong, no bonus
    assert.equal(xpFromEvents(events), 15 + 10 + 10 + 3 + 3);
  });

  it("pays the new-card bonus once, on the card's first event", () => {
    const once = xpFromEvents([ev("a", 1, 3, 100)]);
    assert.equal(once, XP_FIRST + 10);

    const twice = xpFromEvents([ev("a", 1, 3, 100), ev("b", 1, 3, 200)]);
    assert.equal(twice, XP_FIRST + 10 + 10, "the bonus is not paid again");
  });

  it("does not pay the bonus when the first answer was wrong", () => {
    assert.equal(xpFromEvents([ev("a", 1, 1, 100)]), 3);
  });

  it("counts hard and easy as correct — only 'again' is wrong (§6)", () => {
    for (const rating of [2, 3, 4]) {
      assert.equal(xpFromEvents([ev("x", 9, rating, 1)]), XP_FIRST + 10, `rating ${rating}`);
    }
    assert.equal(xpFromEvents([ev("x", 9, 1, 1)]), 3);
  });

  it("decides the bonus by the log, not by arrival order", () => {
    const inOrder = [ev("a", 1, 1, 100), ev("b", 1, 3, 200)];
    const reversed = [...inOrder].reverse();
    // The earliest event was wrong, so no bonus either way.
    assert.equal(xpFromEvents(reversed), xpFromEvents(inOrder));
    assert.equal(xpFromEvents(inOrder), 3 + 10);
  });
});

const XP_FIRST = 15;

describe("levels (§8a)", () => {
  it("uses the thresholds the spec lists", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5].map(levelThreshold),
      [100, 300, 600, 1000, 1500],
    );
  });

  it("agrees with the Stats designs", () => {
    // "level 7 · 2,800" with 3,140 XP, and "level 23 · 27,600" with 28,940.
    assert.equal(levelThreshold(7), 2800);
    assert.equal(levelForXp(3140), 7);
    assert.equal(levelThreshold(23), 27_600);
    assert.equal(levelForXp(28_940), 23);
  });

  it("never shows a level 0 — level 1 absorbs the range below 300", () => {
    assert.equal(levelForXp(0), 1);
    assert.equal(levelForXp(99), 1);
    assert.equal(levelForXp(299), 1);
    assert.equal(levelFloor(1), 0);
  });

  it("levels up exactly at the threshold from there on", () => {
    assert.equal(levelForXp(300), 2);
    assert.equal(levelForXp(599), 2);
    assert.equal(levelForXp(600), 3);
    assert.equal(levelFloor(3), 600);
  });
});

// ── the delicate part ────────────────────────────────────────────────
describe("streak and jokers (§8a)", () => {
  const days = (...ds) => ds.map((d) => `2026-03-${String(d).padStart(2, "0")}`);
  const day = (d) => `2026-03-${String(d).padStart(2, "0")}`;

  it("is zero with nothing to go on", () => {
    const s = streakFromDays([], day(10));
    assert.deepEqual({ current: s.current, longest: s.longest, jokers: s.jokers }, {
      current: 0, longest: 0, jokers: 0,
    });
  });

  it("counts consecutive qualifying days", () => {
    const s = streakFromDays(days(1, 2, 3, 4), day(4));
    assert.equal(s.current, 4);
    assert.equal(s.longest, 4);
  });

  it("earns a joker every fifth consecutive day", () => {
    assert.equal(streakFromDays(days(1, 2, 3, 4), day(4)).jokers, 0);
    assert.equal(streakFromDays(days(1, 2, 3, 4, 5), day(5)).jokers, 1);
    assert.equal(streakFromDays(days(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), day(10)).jokers, 2);
  });

  it("holds at most three", () => {
    const twentyFive = Array.from({ length: 25 }, (_, i) => day(i + 1));
    const s = streakFromDays(twentyFive, day(25));
    assert.equal(s.current, 25);
    assert.equal(s.jokers, 3, "five jokers were earned, three are held");
  });

  it("spends a joker on a missed day and keeps the streak", () => {
    // Five days earn one, day 6 is missed, day 7 continues.
    const s = streakFromDays(days(1, 2, 3, 4, 5, 7), day(7));
    assert.equal(s.jokers, 0, "the joker was spent");
    assert.equal(s.current, 6, "the streak counts the days practised, unbroken");
    assert.equal(s.jokerSpentOn, day(6));
  });

  it("resets the streak when a day is missed with no joker in hand", () => {
    const s = streakFromDays(days(1, 2, 4), day(4));
    assert.equal(s.current, 1, "only day 4 survives");
    assert.equal(s.longest, 2, "the first run is remembered");
    assert.equal(s.jokers, 0);
  });

  it("lets unspent jokers survive a reset, and restarts the five-day counter", () => {
    // Ten days earn two jokers. Then three days are missed: two are covered,
    // the third resets the streak. The remaining balance is zero, and the run
    // that follows has to reach five again before it earns anything.
    const s = streakFromDays([...days(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), ...days(14, 15, 16, 17)], day(17));
    assert.equal(s.jokers, 0, "both jokers went on days 11 and 12; day 13 reset it");
    assert.equal(s.current, 4, "days 14-17");
    assert.equal(s.longest, 10, "only days actually practised are counted");
  });

  it("counts days practised, not days elapsed — a covered day adds nothing", () => {
    // The joker keeps the run alive; it does not invent a day of study. Five
    // days practised, one covered, one practised is a streak of six, not seven.
    const s = streakFromDays(days(1, 2, 3, 4, 5, 7), day(7));
    assert.equal(s.current, 6);
    assert.equal(
      streakFromDays(days(1, 2, 3, 4, 5, 6, 7), day(7)).current,
      7,
      "seven days actually practised is seven",
    );
  });

  it("does not let today break the streak", () => {
    // She practised yesterday and has not started today. The streak stands.
    const s = streakFromDays(days(1, 2, 3), day(4));
    assert.equal(s.current, 3);
    assert.equal(s.jokers, 0, "today is not a gap, so nothing was spent");
  });

  it("breaks the streak the day after, not the same day", () => {
    const s = streakFromDays(days(1, 2, 3), day(5));
    assert.equal(s.current, 0, "day 4 passed unpractised with no joker");
  });
});

describe("the gap a joker covered, for the notice (#86)", () => {
  const days = (...ds) => ds.map((d) => `2026-03-${String(d).padStart(2, "0")}`);
  const day = (d) => `2026-03-${String(d).padStart(2, "0")}`;

  it("is reported on the first day back, before she has practised", () => {
    // The production reproduction: five days, the sixth missed, today the 7th.
    const s = streakFromDays(days(1, 2, 3, 4, 5), day(7));
    assert.deepEqual(s.jokerGap, { firstDay: day(6), lastDay: day(6), days: 1 });
    assert.equal(s.current, 5);
    assert.equal(s.jokers, 0);
  });

  it("is still reported once she has practised today", () => {
    const s = streakFromDays(days(1, 2, 3, 4, 5, 7), day(7));
    assert.deepEqual(s.jokerGap, { firstDay: day(6), lastDay: day(6), days: 1 });
  });

  it("covers several days as one gap", () => {
    // Fifteen days hold three jokers; days 16 and 17 spend two of them.
    const fifteen = Array.from({ length: 15 }, (_, i) => day(i + 1));
    const s = streakFromDays(fifteen, day(18));
    assert.deepEqual(s.jokerGap, { firstDay: day(16), lastDay: day(17), days: 2 });
    assert.equal(s.jokers, 1);
  });

  it("is gone the day after she came back", () => {
    const s = streakFromDays(days(1, 2, 3, 4, 5, 7), day(8));
    assert.equal(s.jokerGap, null);
    assert.equal(s.jokerSpentOn, day(6), "the spend itself is still on record");
  });

  it("is not reported for a gap that ended the streak", () => {
    // One joker, two missed days: the second resets the run, so this is the
    // streak-reset case, which is a different screen.
    const s = streakFromDays(days(1, 2, 3, 4, 5), day(8));
    assert.equal(s.jokerGap, null);
    assert.equal(s.current, 0);
  });

  it("is null with no history and with no gap", () => {
    assert.equal(streakFromDays([], day(3)).jokerGap, null);
    assert.equal(streakFromDays(days(1, 2, 3), day(3)).jokerGap, null);
  });
});

describe("the gap that ended a streak, for the notice (#89)", () => {
  const days = (...ds) => ds.map((d) => `2026-03-${String(d).padStart(2, "0")}`);
  const day = (d) => `2026-03-${String(d).padStart(2, "0")}`;

  it("is reported on the first day back — the live reproduction", () => {
    // Two days practised, four missed, no joker ever earned.
    const s = streakFromDays(days(1, 2), day(7));
    assert.deepEqual(s.streakReset, { firstDay: day(3), lastDay: day(6), days: 4, lost: 2 });
    assert.equal(s.current, 0);
    assert.equal(s.jokerGap, null, "not both notices");
  });

  it("counts the days a joker covered before the jokers ran out", () => {
    // Five days earn one joker; day 6 spends it, day 7 ends the streak.
    const s = streakFromDays(days(1, 2, 3, 4, 5), day(8));
    assert.deepEqual(s.streakReset, { firstDay: day(6), lastDay: day(7), days: 2, lost: 5 });
    assert.equal(s.jokerGap, null);
  });

  it("is still reported once she has practised today", () => {
    const s = streakFromDays(days(1, 2, 5), day(5));
    assert.deepEqual(s.streakReset, { firstDay: day(3), lastDay: day(4), days: 2, lost: 2 });
    assert.equal(s.current, 1);
  });

  it("is gone the day after she came back", () => {
    assert.equal(streakFromDays(days(1, 2, 5), day(6)).streakReset, null);
  });

  it("does not judge today", () => {
    // Day 3 is missed and today is day 4: one day. On day 3 itself nothing has
    // been missed yet — the day is still running.
    assert.equal(streakFromDays(days(1, 2), day(4)).streakReset?.days, 1);
    assert.equal(streakFromDays(days(1, 2), day(3)).streakReset, null, "today is not a missed day yet");
  });

  it("is not reported for a gap the jokers covered", () => {
    assert.equal(streakFromDays(days(1, 2, 3, 4, 5), day(7)).streakReset, null);
  });

  it("is null with no history and with no gap", () => {
    assert.equal(streakFromDays([], day(3)).streakReset, null);
    assert.equal(streakFromDays(days(1, 2, 3), day(3)).streakReset, null);
  });
});

describe("maturity bands", () => {
  const state = (intervalDays, reps = 3) => ({
    reps,
    last_review: 1_000_000,
    due_at: 1_000_000 + intervalDays * DAY,
  });

  it("sorts by the interval the scheduler chose", () => {
    assert.equal(maturityBand(undefined), "new");
    assert.equal(maturityBand({ ...state(5), reps: 0 }), "new");
    assert.equal(maturityBand(state(0.2)), "learning");
    assert.equal(maturityBand(state(3)), "young");
    assert.equal(maturityBand(state(20.9)), "young");
    assert.equal(maturityBand(state(21)), "mature");
    assert.equal(maturityBand(state(400)), "mature");
  });
});

describe("GET /api/stats", () => {
  const uid = (n) => `9f8e7d6c-5b4a-4321-8765-${String(n).padStart(12, "0")}`;

  it("needs a session", async () => {
    const { app } = await testApp();
    assert.equal((await app.inject({ method: "GET", url: "/api/stats" })).statusCode, 401);
    await app.close();
  });

  it("reports zeros for a user who has done nothing", async () => {
    const { app, db, config } = await testApp();
    await seedUser(db);
    seedCards(db, 5);
    const cookie = await signIn(app, config);

    const body = (await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } })).json();
    assert.equal(body.xp, 0);
    assert.equal(body.level, 1);
    assert.equal(body.xpForNextLevel, 300);
    assert.equal(body.streak, 0);
    assert.equal(body.cardsSeen, 0);
    assert.deepEqual(body.maturity, { new: 0, learning: 0, young: 0, mature: 0 });
    // #98: day one still draws the calendar, every day of it empty.
    assert.ok(body.history.length > 5 * 7 && body.history.length <= 6 * 7);
    assert.ok(body.history.every((d) => d.reviews === 0 && d.joker === false));
    await app.close();
  });

  it("derives everything from the log", async () => {
    const { app, db, config } = await testApp();
    const user = await seedUser(db);
    seedCards(db, 5);

    const t = Date.parse("2026-03-10T02:00:00Z") / 1000; // 11:00 in Tokyo
    ingestEvents(
      db,
      user.id,
      [
        { id: uid(1), card_id: 1, mode: "choose", rating: 3, reviewed_at: t },
        { id: uid(2), card_id: 2, mode: "choose", rating: 1, reviewed_at: t + 60 },
        { id: uid(3), card_id: 3, mode: "flip", rating: 4, reviewed_at: t + 120 },
      ],
      t + 300,
    );

    const cookie = await signIn(app, config);
    const body = (await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } })).json();

    // two first-correct (15+10 each) plus one wrong (3)
    assert.equal(body.xp, 25 + 25 + 3);
    assert.equal(body.cardsSeen, 3);
    assert.equal(body.streak, 0, "three reviews is under the ten a day needs");
    await app.close();
  });

  it("counts a qualifying day only past ten reviews", async () => {
    const { app, db, config } = await testApp();
    const user = await seedUser(db);
    seedCards(db, 12);

    const t = Date.parse("2026-03-10T02:00:00Z") / 1000;
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: uid(100 + i),
      card_id: (i % 12) + 1,
      mode: "choose",
      rating: 3,
      reviewed_at: t + i * 60,
    }));
    ingestEvents(db, user.id, events, t + 1000);

    const cookie = await signIn(app, config);
    const body = (await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } })).json();
    assert.equal(body.reviewsToday >= 0, true);
    assert.equal(body.reviewsPerQualifyingDay, 10);
    await app.close();
  });

  it("keeps one user's numbers out of another's", async () => {
    const { app, db, config } = await testApp();
    const mira = await seedUser(db);
    const yuki = await seedUser(db, { handle: "yuki", pin: "112233" });
    seedCards(db, 5);

    const t = Date.parse("2026-03-10T02:00:00Z") / 1000;
    ingestEvents(db, mira.id, [
      { id: uid(1), card_id: 1, mode: "choose", rating: 3, reviewed_at: t },
    ], t);

    const yukiCookie = await signIn(app, config, { handle: "yuki", pin: "112233" });
    const body = (await app.inject({ method: "GET", url: "/api/stats", headers: { cookie: yukiCookie } })).json();
    assert.equal(body.xp, 0);
    assert.equal(body.cardsSeen, 0);
    await app.close();
  });
});

describe("the topic list behind the picker (#35)", () => {
  async function fixture() {
    const { app, db, config } = await testApp();
    await seedUser(db);
    seedCards(db, 6);
    const tag = db.prepare("INSERT INTO tags (card_id, tag) VALUES (?, ?)");
    tag.run(1, "food");
    tag.run(2, "food");
    tag.run(3, "places");
    return { app, db, config };
  }

  it("carries the deck's topics and hers in one list, marked", async () => {
    // One list because it drives two screens that both want every topic: the
    // picker she filters a session with, and the per-topic progress bars.
    const { app, db, config } = await fixture();
    const cookie = await signIn(app, config);
    db.prepare("INSERT INTO card_user_tags (user_id, card_id, tag, added_at) VALUES (1, 5, ?, 0)")
      .run("my exam");

    const { topics } = (
      await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } })
    ).json();

    const byTag = Object.fromEntries(topics.map((t) => [t.tag, t]));
    assert.deepEqual(byTag.food, { tag: "food", total: 2, seen: 0, own: false });
    assert.deepEqual(byTag["my exam"], { tag: "my exam", total: 1, seen: 0, own: true });
    await app.close();
  });

  it("counts a name used by both sides once, as the union", async () => {
    // She puts a third card into `food`. That is one topic with three cards,
    // not two rows called food — and `own` is true, because the fact worth
    // surfacing is that she has touched it.
    const { app, db, config } = await fixture();
    const cookie = await signIn(app, config);
    db.prepare("INSERT INTO card_user_tags (user_id, card_id, tag, added_at) VALUES (1, 4, ?, 0)")
      .run("food");

    const { topics } = (
      await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } })
    ).json();

    const food = topics.filter((t) => t.tag === "food");
    assert.equal(food.length, 1, "one row, not two");
    assert.equal(food[0].total, 3);
    assert.equal(food[0].own, true);
    await app.close();
  });

  it("shows her nothing of another user's topics", async () => {
    const { app, db, config } = await fixture();
    await seedUser(db, { handle: "someone", pin: "111111", display: "Someone" });
    db.prepare("INSERT INTO card_user_tags (user_id, card_id, tag, added_at) VALUES (2, 6, ?, 0)")
      .run("his topic");

    const cookie = await signIn(app, config);
    const { topics } = (
      await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } })
    ).json();
    assert.equal(topics.some((t) => t.tag === "his topic"), false);
    await app.close();
  });

  it("drops a topic whose only card was deleted", async () => {
    const { app, db, config } = await fixture();
    const cookie = await signIn(app, config);
    db.prepare("INSERT INTO card_user_tags (user_id, card_id, tag, added_at) VALUES (1, 6, ?, 0)")
      .run("gone");
    db.prepare("UPDATE cards SET deleted_at = 1 WHERE id = 6").run();

    const { topics } = (
      await app.inject({ method: "GET", url: "/api/stats", headers: { cookie } })
    ).json();
    assert.equal(topics.some((t) => t.tag === "gone"), false);
    await app.close();
  });
});

describe("the calendar on the Stats tab (#98)", () => {
  const counts = (entries) => new Map(Object.entries(entries));
  const march = (d) => `2026-03-${String(d).padStart(2, "0")}`;

  it("runs from the Monday five weeks back through today, every day listed", () => {
    // 2026-09-15 is a Tuesday: its week began on the 14th, five before on 10 August.
    const days = historyDays(counts({}), [], "2026-09-15");
    assert.equal(days[0].day, "2026-08-10");
    assert.equal(days.at(-1).day, "2026-09-15");
    assert.equal(days.length, 5 * 7 + 2);
    for (let i = 1; i < days.length; i++) assert.equal(days[i].day, nextDay(days[i - 1].day));
  });

  it("starts a week on Monday whichever day today is", () => {
    assert.equal(historyDays(counts({}), [], "2026-09-14")[0].day, "2026-08-10");
    assert.equal(historyDays(counts({}), [], "2026-09-14").length, 5 * 7 + 1);
    assert.equal(historyDays(counts({}), [], "2026-09-20").length, 6 * 7, "a Sunday closes a full week");
    assert.equal(historyDays(counts({}), [], "2026-03-01")[0].day, "2026-01-19", "across months");
  });

  it("carries each day's reviews and marks the days a joker covered", () => {
    const days = historyDays(counts({ "2026-09-10": 12, "2026-09-12": 3 }), ["2026-09-11"], "2026-09-15");
    const byDay = Object.fromEntries(days.map((d) => [d.day, d]));
    assert.deepEqual(byDay["2026-09-10"], { day: "2026-09-10", reviews: 12, joker: false });
    assert.deepEqual(byDay["2026-09-11"], { day: "2026-09-11", reviews: 0, joker: true });
    assert.deepEqual(byDay["2026-09-12"], { day: "2026-09-12", reviews: 3, joker: false });
  });

  it("lists every day a joker covered, also in a streak a later gap ended", () => {
    // Five days earn a joker, day 6 spends it, days 7 and 8 end the streak.
    assert.deepEqual(streakFromDays([1, 2, 3, 4, 5].map(march), march(9)).coveredDays, [march(6)]);
    assert.deepEqual(streakFromDays([], march(9)).coveredDays, []);
  });

  it("buckets reviews by the device's day, in GET /api/stats", async () => {
    const { app, db, config } = await testApp();
    const user = await seedUser(db);
    seedCards(db, 12);
    const uid = (n) => `9f8e7d6c-5b4a-4321-8765-${String(n).padStart(12, "0")}`;

    // 23:30 on the 14th in Berlin is already 06:30 on the 15th in Tokyo.
    const t = Date.parse("2026-09-14T21:30:00Z") / 1000;
    ingestEvents(
      db,
      user.id,
      Array.from({ length: 11 }, (_, i) => ({ id: uid(i), card_id: (i % 12) + 1, mode: "choose", rating: 3, reviewed_at: t + i })),
      t + 60,
    );
    const cookie = await signIn(app, config);
    const read = async (zone) =>
      (await app.inject({ method: "GET", url: "/api/stats", headers: { cookie, "x-time-zone": zone } })).json().history;

    const berlin = await read("Europe/Berlin");
    assert.equal(berlin.find((d) => d.day === "2026-09-14")?.reviews, 11);
    const tokyo = await read("Asia/Tokyo");
    assert.equal(tokyo.find((d) => d.day === "2026-09-15")?.reviews, 11);
    assert.equal(tokyo.find((d) => d.day === "2026-09-14")?.reviews ?? 0, 0);
    await app.close();
  });
});

describe("GET /api/cards/:id/history (#98)", () => {
  const uid = (n) => `1a2b3c4d-5e6f-4a1b-8c2d-${String(n).padStart(12, "0")}`;

  async function fixture() {
    const { app, db, config } = await testApp();
    const mira = await seedUser(db);
    await seedUser(db, { handle: "yuki", pin: "112233" });
    seedCards(db, 3);
    const cookie = await signIn(app, config);
    const yuki = await signIn(app, config, { handle: "yuki", pin: "112233" });
    const get = (id, who = cookie) =>
      app.inject({ method: "GET", url: `/api/cards/${id}/history`, headers: { cookie: who, "x-time-zone": "Asia/Tokyo" } });
    return { app, db, mira, cookie, yuki, get };
  }

  it("needs a session", async () => {
    const { app } = await testApp();
    assert.equal((await app.inject({ method: "GET", url: "/api/cards/1/history" })).statusCode, 401);
    await app.close();
  });

  it("lists her reviews of one card, newest first, with the day it is next due", async () => {
    const { app, db, mira, get } = await fixture();
    const t = Date.parse("2026-09-10T02:00:00Z") / 1000; // 11:00 in Tokyo
    ingestEvents(
      db,
      mira.id,
      [
        { id: uid(1), card_id: 1, mode: "choose", rating: 1, reviewed_at: t },
        { id: uid(2), card_id: 1, mode: "flip", rating: 3, reviewed_at: t + 2 * DAY },
        { id: uid(3), card_id: 2, mode: "choose", rating: 3, reviewed_at: t + DAY },
      ],
      t + 3 * DAY,
    );

    const res = await get(1);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.events, [
      { day: "2026-09-12", mode: "flip", rating: 3 },
      { day: "2026-09-10", mode: "choose", rating: 1 },
    ]);
    const state = db.prepare("SELECT due_at FROM card_state WHERE user_id = ? AND card_id = 1").get(mira.id);
    assert.equal(body.dueDay, dayIn(state.due_at, "Asia/Tokyo"));
    // A card still in its learning steps can be due again the same day.
    assert.ok(body.dueDay >= "2026-09-12");
    await app.close();
  });

  it("is empty for a card she has never reviewed", async () => {
    const { app, get } = await fixture();
    const body = (await get(3)).json();
    assert.deepEqual(body.events, []);
    assert.equal(body.dueDay, null);
    assert.equal(body.today, dayIn(Math.floor(Date.now() / 1000), "Asia/Tokyo"));
    await app.close();
  });

  it("works for her own card, whose id is negative, and for no one else", async () => {
    const { app, cookie, yuki, get } = await fixture();
    const res = await app.inject({
      method: "POST",
      url: "/api/cards",
      headers: { cookie },
      payload: { word: "焼き鳥", meaning: "Spieß" },
    });
    const { card } = res.json();
    assert.ok(card.id < 0);

    assert.equal((await get(card.id)).statusCode, 200);
    assert.equal((await get(card.id, yuki)).statusCode, 404, "a friend's word is not hers to read (#84)");
    assert.equal((await get(999)).statusCode, 404);
    await app.close();
  });
});

describe("a card's record says whether it is starred (2026-09-19)", () => {
  it("is false until starred, true after, false once unstarred", async () => {
    const { app, db, config } = await testApp();
    await seedUser(db);
    seedCards(db);
    const cookie = await signIn(app, config);
    const id = db.prepare("SELECT id FROM cards LIMIT 1").get().id;
    const starred = async () =>
      (await app.inject({ method: "GET", url: `/api/cards/${id}/history`, headers: { cookie } })).json().starred;
    const star = (on, changedAt) =>
      app.inject({ method: "POST", url: "/api/stars", headers: { cookie }, payload: { cardId: id, starred: on, changedAt } });

    assert.equal(await starred(), false);
    await star(true, 1_000);
    assert.equal(await starred(), true);
    await star(false, 2_000);
    assert.equal(await starred(), false);
  });
});
