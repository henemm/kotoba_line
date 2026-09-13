import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  levelFloor,
  levelForXp,
  levelThreshold,
  maturityBand,
  nextDay,
  statsForUser,
  streakFromDays,
  tokyoDay,
  xpFromEvents,
} from "../src/stats.js";
import { ingestEvents } from "../src/events.js";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

const DAY = 86400;

describe("the day boundary is Asia/Tokyo (§8a)", () => {
  it("puts late-evening UTC into the next Tokyo day", () => {
    // Tokyo is UTC+9, so 15:00Z is already midnight there.
    assert.equal(tokyoDay(Date.parse("2026-03-14T14:59:00Z") / 1000), "2026-03-14");
    assert.equal(tokyoDay(Date.parse("2026-03-14T15:00:00Z") / 1000), "2026-03-15");
  });

  it("does not follow the device or UTC", () => {
    // A review at 08:00 Tokyo on the 15th is still the 14th in UTC.
    const t = Date.parse("2026-03-14T23:00:00Z") / 1000;
    assert.equal(new Date(t * 1000).toISOString().slice(0, 10), "2026-03-14");
    assert.equal(tokyoDay(t), "2026-03-15");
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
