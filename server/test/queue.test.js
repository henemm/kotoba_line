import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SESSION_LENGTH, browseCards, composeQueue, isFiltered, outlookForUser, queueForUser, setStar, shuffle, whenOnClock } from "../src/queue.js";
import { releaseNewCards } from "../src/deck-settings.js";
import { dayIn, startOfDay } from "../src/day.js";
import { ingestEvents } from "../src/events.js";
import { openDatabase } from "../src/db.js";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

const DAY = 86400;
const NOW = 1_760_000_000;
const uid = (n) => `9f8e7d6c-5b4a-4321-8765-${String(n).padStart(12, "0")}`;

/** A deck with enough shape to exercise the filters. Cards 31–40 are `ownerId`'s own. */
function seedDeck(db, ownerId) {
  const card = db.prepare(
    `INSERT INTO cards (id, word, word_meaning, frequency_rank, deck, owner_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const tag = db.prepare("INSERT INTO tags (card_id, tag) VALUES (?, ?)");

  for (let i = 1; i <= 40; i++) {
    const personal = i > 30;
    card.run(i, `語${i}`, `word ${i}`, i, personal ? "personal" : "kaishi", personal ? ownerId : null, NOW - DAY);
  }
  for (const id of [1, 2, 3, 4, 5]) tag.run(id, "food");
  for (const id of [5, 6, 7]) tag.run(id, "school");
}

/** Put a card into a known scheduler state without going through FSRS. */
function setState(db, userId, cardId, { dueAt, lapses = 0, lastReview = NOW - DAY, reps = 3 }) {
  db.prepare(
    `INSERT INTO card_state (user_id, card_id, due_at, stability, difficulty, reps, lapses, last_review)
     VALUES (?, ?, ?, 1, 5, ?, ?, ?)`,
  ).run(userId, cardId, dueAt, reps, lapses, lastReview);
}

/**
 * #210: the lapsed group reads her *last answer* from the log, not
 * `card_state.lapses`. Writes the reviews that `setState` only summarises —
 * `ratings` in order, the last one at `lastReview`, a minute apart.
 */
let eventSeq = 0;
function setHistory(db, userId, cardId, ratings, lastReview = NOW - DAY) {
  const insert = db.prepare(
    `INSERT INTO review_events (id, user_id, card_id, mode, rating, reviewed_at, received_at) VALUES (?, ?, ?, 'flip', ?, ?, ?)`,
  );
  ratings.forEach((rating, i) => {
    const at = lastReview - (ratings.length - 1 - i) * 60;
    insert.run(uid(9000 + eventSeq++), userId, cardId, rating, at, at);
  });
}

async function fixture() {
  const { app, db, config } = await testApp();
  const user = await seedUser(db);
  seedDeck(db, user.id);
  return { app, db, config, user };
}

describe("queue composition (§5)", () => {
  it("takes due first, then recently lapsed, then new", () => {
    const q = composeQueue({ due: [1, 2], lapsed: [3], fresh: [4, 5] }, 10);
    assert.deepEqual(q, [1, 2, 3, 4, 5]);
  });

  it("never repeats a card that qualifies twice", () => {
    const q = composeQueue({ due: [1, 2], lapsed: [2, 3], fresh: [3, 4] }, 10);
    assert.deepEqual(q, [1, 2, 3, 4]);
  });

  it("stops at the limit, keeping the earlier groups", () => {
    assert.deepEqual(composeQueue({ due: [1, 2, 3], lapsed: [4], fresh: [5] }, 3), [1, 2, 3]);
    assert.deepEqual(composeQueue({ due: [1], lapsed: [2], fresh: [3, 4] }, 3), [1, 2, 3]);
  });

  it("copes with empty groups", () => {
    assert.deepEqual(composeQueue({ due: [], lapsed: [], fresh: [] }, 10), []);
    assert.deepEqual(composeQueue({ due: [], lapsed: [], fresh: [7] }, 10), [7]);
  });
});

describe("shuffle", () => {
  it("keeps every card and loses none", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(input);
    assert.deepEqual([...out].sort((a, b) => a - b), input);
    assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8], "the input is not mutated");
  });

  it("is deterministic when the randomness is", () => {
    const fixed = () => 0.42;
    assert.deepEqual(shuffle([1, 2, 3, 4, 5], fixed), shuffle([1, 2, 3, 4, 5], fixed));
  });
});

describe("what counts as a chosen session (§5a)", () => {
  it("is a topic or an only — not the deck or list she practises in (#137)", () => {
    assert.equal(isFiltered({}), false);
    assert.equal(isFiltered({ deck: "personal" }), false);
    assert.equal(isFiltered({ deck: "personal", list: "100 vokabeln" }), false);
    assert.equal(isFiltered({ tag: "food" }), true);
    assert.equal(isFiltered({ only: "starred" }), true);
    assert.equal(isFiltered({ mode: "choose" }), false, "a mode is not a filter");
  });
});

describe("queueForUser", () => {
  it("introduces new cards in frequency order, capped at the daily limit", async () => {
    const { app, db, user } = await fixture();
    const q = queueForUser(db, user.id, {}, NOW, () => 0);
    // Default limit is 15 a day and nothing has been seen yet.
    assert.equal(q.cardIds.length, 15);
    assert.deepEqual([...q.cardIds].sort((a, b) => a - b), Array.from({ length: 15 }, (_, i) => i + 1));
    assert.equal(q.filtered, false);
    await app.close();
  });

  it("puts due cards ahead of new ones", async () => {
    const { app, db, user } = await fixture();
    setState(db, user.id, 30, { dueAt: NOW - 100 });
    const q = queueForUser(db, user.id, { limit: 3 }, NOW, () => 0);
    assert.ok(q.cardIds.includes(30), "the due card is in the session");
    await app.close();
  });

  it("does not offer a card that is not due yet", async () => {
    const { app, db, user } = await fixture();
    setState(db, user.id, 30, { dueAt: NOW + 5 * DAY });
    const q = queueForUser(db, user.id, { limit: 40 }, NOW, () => 0);
    assert.ok(!q.cardIds.includes(30));
    await app.close();
  });

  it("brings back a card lapsed in the last three days even when it is not due", async () => {
    const { app, db, user } = await fixture();
    setState(db, user.id, 31, { dueAt: NOW + 10 * DAY, lapses: 2, lastReview: NOW - DAY });
    setHistory(db, user.id, 31, [3, 1], NOW - DAY);
    const q = queueForUser(db, user.id, { limit: 40 }, NOW, () => 0);
    assert.ok(q.cardIds.includes(31), "a fresh lapse comes back regardless of due date");
    await app.close();
  });

  it("leaves an old lapse alone", async () => {
    const { app, db, user } = await fixture();
    setState(db, user.id, 31, { dueAt: NOW + 10 * DAY, lapses: 2, lastReview: NOW - 10 * DAY });
    setHistory(db, user.id, 31, [3, 1], NOW - 10 * DAY);
    const q = queueForUser(db, user.id, { limit: 40 }, NOW, () => 0);
    assert.ok(!q.cardIds.includes(31));
    await app.close();
  });

  // #210: measured in her log, 2026-09-18 — one Nochmal, then Gut with
  // "1 Tag" on the button, and the card back within a minute, four times.
  it("a lapse she has since answered right stays away until it is due (#210)", async () => {
    const { app, db, user } = await fixture();
    // Nochmal yesterday, Gut an hour ago, due tomorrow: `lapses` is still 1.
    setState(db, user.id, 31, { dueAt: NOW + DAY, lapses: 1, lastReview: NOW - 3600 });
    setHistory(db, user.id, 31, [1, 3], NOW - 3600);
    const q = queueForUser(db, user.id, { limit: 40 }, NOW, () => 0);
    assert.ok(!q.cardIds.includes(31), "Gut after a lapse keeps the button's promise");
    assert.equal(queueForUser(db, user.id, { only: "lapsed", limit: 40 }, NOW, () => 0).cardIds.length, 0);
    assert.equal(outlookForUser(db, user.id, NOW).lapsed, 0, "the Letzte Fehler count agrees");
    await app.close();
  });

  it("a card whose last answer was Nochmal is a recent lapse whatever its due date (#210)", async () => {
    const { app, db, user } = await fixture();
    setState(db, user.id, 31, { dueAt: NOW + DAY, lapses: 1, lastReview: NOW - 3600 });
    setHistory(db, user.id, 31, [3, 3, 1], NOW - 3600);
    const q = queueForUser(db, user.id, { limit: 40 }, NOW, () => 0);
    assert.ok(q.cardIds.includes(31));
    assert.equal(outlookForUser(db, user.id, NOW).lapsed, 1);
    await app.close();
  });

  it("respects the daily new-card limit across sessions, not per session", async () => {
    const { app, db, user } = await fixture();
    const events = Array.from({ length: 12 }, (_, i) => ({
      id: uid(i), card_id: i + 1, mode: "choose", rating: 3, reviewed_at: NOW - 3600,
    }));
    ingestEvents(db, user.id, events, NOW);

    const q = queueForUser(db, user.id, { limit: 40 }, NOW, () => 0);
    const fresh = q.cardIds.filter((id) => id > 12);
    assert.equal(fresh.length, 3, "12 of today's 15 are spent, so 3 new remain");
    await app.close();
  });

  it("gives a new day its whole allowance, from midnight on her clock (#122)", async () => {
    const { app, db, user } = await fixture();
    // Ten new cards at 22:00 in Tokyo; the next morning at 06:00 is 8 hours
    // later. The last 24 hours still held them; the day does not.
    const evening = Math.floor(Date.parse("2025-10-08T22:00:00+09:00") / 1000);
    const morning = Math.floor(Date.parse("2025-10-09T06:00:00+09:00") / 1000);
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: uid(i), card_id: i + 1, mode: "choose", rating: 3, reviewed_at: evening + i,
    }));
    ingestEvents(db, user.id, events, evening + 60);

    const tokyo = queueForUser(db, user.id, { limit: 60, timeZone: "Asia/Tokyo" }, morning, () => 0);
    assert.equal(tokyo.cardIds.filter((id) => id > 10).length, 15, "all 15 of today's new cards");

    // The same moments in Berlin: 15:00 and 23:00 the same day, so the ten
    // were today's there, and 5 remain.
    const berlin = queueForUser(db, user.id, { limit: 60, timeZone: "Europe/Berlin" }, morning, () => 0);
    assert.equal(berlin.cardIds.filter((id) => id > 10).length, 5);
    await app.close();
  });

  it("does not cap a session she chose (§5a)", async () => {
    const { app, db, user } = await fixture();
    const events = Array.from({ length: 15 }, (_, i) => ({
      id: uid(i), card_id: i + 1, mode: "choose", rating: 3, reviewed_at: NOW - 3600,
    }));
    ingestEvents(db, user.id, events, NOW);

    const unfiltered = queueForUser(db, user.id, { limit: 40 }, NOW, () => 0);
    assert.equal(
      unfiltered.cardIds.filter((id) => id > 15).length,
      0,
      "the daily limit is spent",
    );

    const chosen = queueForUser(db, user.id, { only: "new", limit: 40 }, NOW, () => 0);
    assert.ok(chosen.cardIds.length > 0, "a chosen session still has cards");
    assert.equal(chosen.filtered, true);
    await app.close();
  });

  it("keeps the daily limit inside a deck she practises in (#137)", async () => {
    const { app, db, user } = await fixture();
    const events = Array.from({ length: 15 }, (_, i) => ({
      id: uid(i), card_id: i + 1, mode: "choose", rating: 3, reviewed_at: NOW - 3600,
    }));
    ingestEvents(db, user.id, events, NOW);

    const mine = queueForUser(db, user.id, { deck: "personal", limit: 40 }, NOW, () => 0);
    assert.equal(mine.cardIds.length, 0, "her own words wait for tomorrow like the rest");
    assert.equal(mine.filtered, false);
    assert.equal(mine.newCapReached, true, "and the answer says why the set is empty");
    assert.equal(
      queueForUser(db, user.id, { deck: "personal", only: "new", limit: 40 }, NOW, () => 0).newCapReached,
      false,
    );
    await app.close();
  });

  it("filters by deck", async () => {
    const { app, db, user } = await fixture();
    const q = queueForUser(db, user.id, { deck: "personal", limit: 40 }, NOW, () => 0);
    assert.ok(q.cardIds.length > 0);
    assert.ok(q.cardIds.every((id) => id > 30), "only the personal deck");
    await app.close();
  });

  it("filters by tag", async () => {
    const { app, db, user } = await fixture();
    const q = queueForUser(db, user.id, { tag: "school", limit: 40 }, NOW, () => 0);
    assert.deepEqual([...q.cardIds].sort((a, b) => a - b), [5, 6, 7]);
    await app.close();
  });

  it("builds a session from exactly the starred cards", async () => {
    const { app, db, user } = await fixture();
    setStar(db, user.id, 21, true);
    setStar(db, user.id, 22, true);

    const q = queueForUser(db, user.id, { only: "starred", limit: 40 }, NOW, () => 0);
    assert.deepEqual([...q.cardIds].sort((a, b) => a - b), [21, 22]);
    await app.close();
  });

  it("only=lapsed returns lapses and nothing else", async () => {
    const { app, db, user } = await fixture();
    setState(db, user.id, 8, { dueAt: NOW - 100 });                       // due, not lapsed
    setState(db, user.id, 9, { dueAt: NOW + DAY, lapses: 1, lastReview: NOW - DAY });
    setHistory(db, user.id, 9, [1], NOW - DAY);
    const q = queueForUser(db, user.id, { only: "lapsed", limit: 40 }, NOW, () => 0);
    assert.deepEqual(q.cardIds, [9]);
    await app.close();
  });

  it("only=new introduces fresh cards regardless of what is due", async () => {
    const { app, db, user } = await fixture();
    setState(db, user.id, 1, { dueAt: NOW - 100 });
    const q = queueForUser(db, user.id, { only: "new", limit: 5 }, NOW, () => 0);
    assert.equal(q.cardIds.length, 5);
    assert.ok(!q.cardIds.includes(1), "card 1 is not new any more");
    await app.close();
  });

  it("only=ahead returns the cards due within two days, soonest first, and no new ones (#90)", async () => {
    const { app, db, user } = await fixture();
    setState(db, user.id, 8, { dueAt: NOW + 2 * DAY - 1 });
    setState(db, user.id, 9, { dueAt: NOW + 3600 });
    setState(db, user.id, 10, { dueAt: NOW + 2 * DAY + 1 });            // three days out: not ahead
    setState(db, user.id, 11, { dueAt: NOW - 60 });                     // already due counts
    const q = queueForUser(db, user.id, { only: "ahead", limit: 40 }, NOW, () => 0.999);
    assert.deepEqual([...q.cardIds].sort((a, b) => a - b), [8, 9, 11]);
    assert.equal(q.available, 3);
    assert.equal(q.filtered, true, "a chosen session: the daily new-card cap is not its business");
    await app.close();
  });

  it("caps the session length however large a limit is asked for", async () => {
    const { app, db, user } = await fixture();
    const q = queueForUser(db, user.id, { deck: "kaishi", limit: MAX_SESSION_LENGTH }, NOW, () => 0);
    assert.ok(q.cardIds.length <= MAX_SESSION_LENGTH);
    await app.close();
  });

  it("keeps one user's stars out of another's session", async () => {
    const { app, db, user } = await fixture();
    const yuki = await seedUser(db, { handle: "yuki", pin: "112233" });
    setStar(db, user.id, 21, true);

    const q = queueForUser(db, yuki.id, { only: "starred", limit: 40 }, NOW, () => 0);
    assert.deepEqual(q.cardIds, []);
    await app.close();
  });
});

describe("the nothing-due outlook (design 10; #90, #91)", () => {
  // NOW is 2025-10-09 17:53:20 in Tokyo, 10:53:20 in Berlin.
  it("says when on the device's clock, by name, by weekday, then by date", () => {
    assert.equal(whenOnClock(NOW + 3600, NOW), "heute 18:53", "Tokyo without a zone");
    const tomorrowSix = Math.floor(Date.parse("2025-10-10T06:00:00+09:00") / 1000);
    assert.equal(whenOnClock(tomorrowSix, NOW, "Asia/Tokyo"), "morgen 06:00");
    assert.equal(whenOnClock(tomorrowSix + 2 * DAY, NOW, "Asia/Tokyo"), "So 06:00");
    assert.equal(whenOnClock(tomorrowSix + 20 * DAY, NOW, "Asia/Tokyo"), "30. Okt. 06:00");
    // Tokyo's 06:00 tomorrow is 23:00 tonight in Berlin.
    assert.equal(whenOnClock(tomorrowSix, NOW, "Europe/Berlin"), "heute 23:00");
  });

  it("counts the offers with the queue's own rules, and finds the next due day", async () => {
    const { app, db, user } = await fixture();
    const tomorrowSix = Math.floor(Date.parse("2025-10-10T06:00:00+09:00") / 1000);
    setState(db, user.id, 1, { dueAt: tomorrowSix });
    setState(db, user.id, 2, { dueAt: tomorrowSix + 3600 });
    setState(db, user.id, 3, { dueAt: tomorrowSix + 17 * 3600, lapses: 1, lastReview: NOW - DAY }); // 23:00, the same day in Tokyo
    setHistory(db, user.id, 3, [1], NOW - DAY);
    setState(db, user.id, 4, { dueAt: tomorrowSix + 19 * 3600 });                                    // 01:00 the day after
    setState(db, user.id, 5, { dueAt: NOW + 10 * DAY });

    const o = outlookForUser(db, user.id, NOW);
    assert.equal(o.ahead, 4, "cards 1–4 are due within two days");
    assert.equal(o.lapsed, 1);
    assert.deepEqual(o.nextDue, { count: 3, at: tomorrowSix, when: "morgen 06:00" });
    await app.close();
  });

  it("has no next due card for someone who has never reviewed", async () => {
    const { app, db, user } = await fixture();
    const o = outlookForUser(db, user.id, NOW);
    assert.equal(o.ahead, 0);
    assert.equal(o.lapsed, 0);
    assert.equal(o.nextDue, null);
    // #179: everything is unseen, so there is always more to learn.
    assert.ok(o.fresh > 0);
    await app.close();
  });

  it("offers the cards she has never seen, past the day's allowance (#179)", async () => {
    const { app, db, user } = await fixture();
    // The day's new cards are used up, and nothing is due.
    db.prepare("UPDATE user_settings SET new_per_day = 5 WHERE user_id = ?").run(user.id);
    for (let card = 1; card <= 5; card++) {
      db.prepare(
        "INSERT INTO review_events (id, user_id, card_id, mode, rating, reviewed_at, received_at) VALUES (?, ?, ?, 'flip', 3, ?, ?)",
      ).run(`e${card}`, user.id, card, NOW - 60, NOW - 60);
      setState(db, user.id, card, { dueAt: NOW + 10 * DAY });
    }

    const o = outlookForUser(db, user.id, NOW);
    assert.equal(o.ahead, 0, "nothing due within two days");
    assert.ok(o.fresh > 0, "but unseen cards are still offered");
    // Within one deck it counts that deck's own unseen cards.
    assert.ok(outlookForUser(db, user.id, NOW, { deckKey: "kaishi" }).fresh > 0);

    // v90: taking the offer releases one more batch for *that* day, and the
    // ordinary queue — not a chosen set — then has cards in it again.
    const today = dayIn(NOW, "Asia/Tokyo");
    assert.equal(queueForUser(db, user.id, { deckKey: "kaishi", timeZone: "Asia/Tokyo" }, NOW).cardIds.length, 0);
    const after = releaseNewCards(db, user.id, "kaishi", today);
    assert.equal(after.extraNew, 5, "one batch, the deck's own daily number");
    assert.equal(after.extraNewDay, today);
    assert.equal(queueForUser(db, user.id, { deckKey: "kaishi", timeZone: "Asia/Tokyo" }, NOW).cardIds.length, 5);

    // Tapping it again takes another batch; yesterday's release counts for
    // nothing, and a different device zone is a different day.
    assert.equal(releaseNewCards(db, user.id, "kaishi", today).extraNew, 10);
    assert.equal(queueForUser(db, user.id, { deckKey: "kaishi", timeZone: "Asia/Tokyo" }, NOW).cardIds.length, 10);
    assert.equal(releaseNewCards(db, user.id, "kaishi", "2000-01-01").extraNew, 5, "another day starts again");
    assert.equal(queueForUser(db, user.id, { deckKey: "kaishi", timeZone: "Asia/Tokyo" }, NOW).cardIds.length, 0);
    await app.close();
  });

  it("leaves someone else's own words out of the counts (#84)", async () => {
    const { app, db, user } = await fixture();
    const yuki = await seedUser(db, { handle: "yuki", pin: "112233" });
    setState(db, yuki.id, 31, { dueAt: NOW + 3600 }); // card 31 is mira's own word
    const o = outlookForUser(db, yuki.id, NOW);
    assert.equal(o.ahead, 0);
    assert.equal(o.lapsed, 0);
    assert.equal(o.nextDue, null);
    await app.close();
  });
});

describe("browse (§5a)", () => {
  it("searches Japanese and English", async () => {
    const { app, db, user } = await fixture();
    assert.equal(browseCards(db, user.id, { q: "語7" }).cards[0].word, "語7");
    assert.ok(browseCards(db, user.id, { q: "word 12" }).cards.some((c) => c.id === 12));
    await app.close();
  });

  it("anchors an English search to the start of a word", async () => {
    const { app, db, user } = await fixture();
    const add = db.prepare(
      `INSERT INTO cards (id, word, word_meaning, frequency_rank, deck, updated_at)
       VALUES (?, ?, ?, ?, 'kaishi', 0)`,
    );
    add.run(101, "食べる", "to eat", 101);
    add.run(102, "作る", "to make, to create", 102);
    add.run(103, "凄い", "wonderful, great, a lot", 103);
    add.run(104, "空", "sky, weather", 104);
    add.run(105, "頂きます", "let's eat!, thank you for the meal", 105);
    add.run(106, "食事", "eating, a meal", 106);

    const ids = browseCards(db, user.id, { q: "eat" }).cards.map((c) => c.id);
    assert.ok(ids.includes(101), "to eat");
    assert.ok(ids.includes(105), "after a comma or an apostrophe");
    assert.ok(ids.includes(106), "a prefix match keeps 'eating'");
    assert.ok(!ids.includes(102), "create must not match");
    assert.ok(!ids.includes(103), "great must not match");
    assert.ok(!ids.includes(104), "weather must not match");
    await app.close();
  });

  // v69: "naru" found nothing while the app showed "naru" (Henning). The same
  // `searchRomaji` as the phone's offline search; client/test/search.test.js
  // covers the folding.
  it("finds a card by its romaji, exact match first, from a word's start", async () => {
    const { app, db, user } = await fixture();
    const add = db.prepare(
      `INSERT INTO cards (id, word, word_reading, word_meaning, frequency_rank, deck, updated_at)
       VALUES (?, ?, ?, ?, ?, 'kaishi', 0)`,
    );
    add.run(201, "なるほど", "なるほど", "I see", 201);
    add.run(202, "鳴る", "なる", "to ring", 202);
    add.run(203, "無くなる", "なくなる", "to be lost", 203);
    add.run(204, "大きい", "おおきい", "big", 204);
    add.run(205, "手", "て", "hand", 205);

    const ids = (q) => browseCards(db, user.id, { q }).cards.map((c) => c.id);
    assert.deepEqual(ids("naru"), [202, 201], "鳴る is exactly naru and comes first; nakunaru is not a match");
    assert.deepEqual(ids("okii"), [204]);
    assert.ok(!ids("tee").includes(205), "a German word keeps its doubled vowel");
    assert.equal(browseCards(db, user.id, { q: "naru" }).total, 2);
    assert.ok(browseCards(db, user.id, { q: "naru" }).cards[0].word_audio !== undefined, "rows carry their recording");
    await app.close();
  });

  it("matches a gloss that starts with the term", async () => {
    const { app, db, user } = await fixture();
    db.prepare(
      `INSERT INTO cards (id, word, word_meaning, frequency_rank, deck, updated_at)
       VALUES (110, '雨', 'rain', 110, 'kaishi', 0)`,
    ).run();
    assert.ok(browseCards(db, user.id, { q: "rain" }).cards.some((c) => c.id === 110));
    await app.close();
  });

  it("reports the full count alongside one page", async () => {
    const { app, db, user } = await fixture();
    const page = browseCards(db, user.id, { pageSize: 10 });
    assert.equal(page.cards.length, 10);
    assert.equal(page.total, 40, "the total is the whole result, not the page");
    await app.close();
  });

  it("pages without repeating or skipping", async () => {
    const { app, db, user } = await fixture();
    const first = browseCards(db, user.id, { pageSize: 10, page: 0 }).cards.map((c) => c.id);
    const second = browseCards(db, user.id, { pageSize: 10, page: 1 }).cards.map((c) => c.id);
    assert.equal(new Set([...first, ...second]).size, 20);
    await app.close();
  });

  it("filters by deck, tag and starred", async () => {
    const { app, db, user } = await fixture();
    setStar(db, user.id, 3, true);

    assert.ok(browseCards(db, user.id, { deck: "personal" }).cards.every((c) => c.id > 30));
    assert.deepEqual(
      browseCards(db, user.id, { tag: "food" }).cards.map((c) => c.id),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(browseCards(db, user.id, { starred: true }).cards.map((c) => c.id), [3]);
    await app.close();
  });

  it("shows each card's own star state", async () => {
    const { app, db, user } = await fixture();
    setStar(db, user.id, 2, true);
    const cards = browseCards(db, user.id, { pageSize: 5 }).cards;
    assert.equal(cards.find((c) => c.id === 2).starred, true);
    assert.equal(cards.find((c) => c.id === 1).starred, false);
    await app.close();
  });
});

describe("stars (§5a)", () => {
  it("pins and unpins", async () => {
    const { app, db, user } = await fixture();
    assert.deepEqual(setStar(db, user.id, 5, true), { ok: true, cardId: 5, starred: true });
    assert.equal(browseCards(db, user.id, { starred: true }).total, 1);

    setStar(db, user.id, 5, false);
    assert.equal(browseCards(db, user.id, { starred: true }).total, 0);
    await app.close();
  });

  it("is safe to pin twice", async () => {
    const { app, db, user } = await fixture();
    setStar(db, user.id, 5, true);
    setStar(db, user.id, 5, true);
    assert.equal(browseCards(db, user.id, { starred: true }).total, 1);
    await app.close();
  });

  it("refuses a card that does not exist", async () => {
    const { app, db, user } = await fixture();
    assert.deepEqual(setStar(db, user.id, 9999, true), { ok: false, reason: "unknown_card" });
    await app.close();
  });

  describe("as a last-write-wins register (#22)", () => {
    it("ignores a write that is older than what is already stored", async () => {
      // Two devices, one offline for a while: the star that reaches the
      // server first is not necessarily the one that happened first, and the
      // one that happened first must not lose just because it arrived second.
      const { app, db, user } = await fixture();
      setStar(db, user.id, 5, true, 200);
      const result = setStar(db, user.id, 5, false, 100); // decided earlier, arrives later
      assert.equal(result.starred, true, "reports what is actually stored, not what was requested");
      assert.equal(browseCards(db, user.id, { starred: true }).total, 1);
      await app.close();
    });

    it("applies a write at the same timestamp — idempotent, not a race", async () => {
      // The exact case an offline retry produces: the same action, sent
      // twice, carrying the same `changedAt` both times.
      const { app, db, user } = await fixture();
      setStar(db, user.id, 5, true, 500);
      const again = setStar(db, user.id, 5, true, 500);
      assert.equal(again.starred, true);
      assert.equal(browseCards(db, user.id, { starred: true }).total, 1);
      await app.close();
    });

    it("applies a newer write regardless of arrival order", async () => {
      const { app, db, user } = await fixture();
      setStar(db, user.id, 5, true, 100);
      const result = setStar(db, user.id, 5, false, 200); // decided later, correctly wins
      assert.equal(result.starred, false);
      assert.equal(browseCards(db, user.id, { starred: true }).total, 0);
      await app.close();
    });
  });
});

describe("the endpoints", () => {
  it("all need a session", async () => {
    const { app } = await fixture();
    for (const url of ["/api/deck", "/api/queue", "/api/browse"]) {
      assert.equal((await app.inject({ method: "GET", url })).statusCode, 401, url);
    }
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/stars",
          payload: { cardId: 1, starred: true, changedAt: Math.floor(Date.now() / 1000) },
        })
      ).statusCode,
      401,
    );
    await app.close();
  });

  it("GET /api/deck returns cards with their tags, and only what changed", async () => {
    const { app, db, config } = await fixture();
    const cookie = await signIn(app, config);

    const all = (await app.inject({ method: "GET", url: "/api/deck", headers: { cookie } })).json();
    assert.equal(all.cards.length, 40);
    assert.deepEqual(all.cards.find((c) => c.id === 5).tags.sort(), ["food", "school"]);

    const since = (
      await app.inject({ method: "GET", url: `/api/deck?since=${all.latest}`, headers: { cookie } })
    ).json();
    assert.equal(since.cards.length, 0, "nothing has changed since the newest card");
    await app.close();
  });

  it("GET /api/queue sends the outlook with an empty day, and accepts only=ahead (#90, #91)", async () => {
    const { app, db, config, user } = await fixture();
    const cookie = await signIn(app, config);
    const now = Math.floor(Date.now() / 1000);
    // The daily allowance spent, and one card due in an hour.
    await app.inject({ method: "PATCH", url: "/api/settings", headers: { cookie }, payload: { newPerDay: 5 } });
    // At `now`, not a minute before: the allowance is the calendar day's (#122),
    // and a minute before can be yesterday.
    const events = [1, 2, 3, 4, 5].map((id) => ({ id: uid(100 + id), card_id: id, mode: "flip", rating: 4, reviewed_at: now }));
    ingestEvents(db, user.id, events, now);
    setState(db, user.id, 6, { dueAt: now + 3600 });

    const empty = (await app.inject({ method: "GET", url: "/api/queue?limit=60", headers: { cookie } })).json();
    assert.deepEqual(empty.cardIds, []);
    assert.equal(empty.outlook.ahead, 1);
    assert.equal(empty.outlook.nextDue.count, 1);

    const ahead = await app.inject({ method: "GET", url: "/api/queue?only=ahead&limit=20", headers: { cookie } });
    assert.equal(ahead.statusCode, 200);
    assert.deepEqual(ahead.json().cardIds, [6]);
    assert.equal(ahead.json().outlook, undefined, "only an unfiltered empty day carries it");
    await app.close();
  });

  it("counts the day in the zone the device sends, and Tokyo without one (#122)", async () => {
    const { app, db, config, user } = await fixture();
    const cookie = await signIn(app, config);
    // Five new cards a minute before midnight in Berlin: yesterday there, for
    // certain. The route runs on the real clock, so whether that minute is
    // still today in Tokyo depends on the hour the test runs — and the
    // expectation says so rather than hoping.
    const now = Math.floor(Date.now() / 1000);
    const at = startOfDay(dayIn(now, "Europe/Berlin"), "Europe/Berlin") - 60;
    const events = [1, 2, 3, 4, 5].map((id) => ({ id: uid(200 + id), card_id: id, mode: "flip", rating: 3, reviewed_at: at }));
    ingestEvents(db, user.id, events, now);
    const inTokyo = dayIn(at, "Asia/Tokyo") === dayIn(now, "Asia/Tokyo") ? 10 : 15;

    const today = async (headers) =>
      (await app.inject({ method: "GET", url: "/api/decks", headers: { cookie, ...headers } })).json().decks[0].today;
    assert.equal((await today({ "x-time-zone": "Europe/Berlin" })).fresh, 15);
    assert.equal((await today({})).fresh, inTokyo, "a shell from before #122 keeps Tokyo");
    assert.equal((await today({ "x-time-zone": "Not/AZone" })).fresh, inTokyo, "a zone Intl does not know is Tokyo, not a 500");
    await app.close();
  });

  it("GET /api/queue returns ids only", async () => {
    const { app, config } = await fixture();
    const cookie = await signIn(app, config);
    const body = (await app.inject({ method: "GET", url: "/api/queue?limit=5", headers: { cookie } })).json();
    assert.equal(body.cardIds.length, 5);
    assert.ok(body.cardIds.every((id) => typeof id === "number"), "ids, not card content");
    await app.close();
  });

  it("says which of the queue's cards are starred (#35)", async () => {
    // The session draws a ★ on every card. Stars are per user and live in
    // card_stars, so the cached public deck cannot carry them — they ride
    // along with the queue, which is also what makes them available offline.
    const { app, config } = await fixture();
    const cookie = await signIn(app, config);

    const before = (
      await app.inject({ method: "GET", url: "/api/queue?limit=5", headers: { cookie } })
    ).json();
    assert.deepEqual(before.starred, [], "nothing starred yet");

    const pick = before.cardIds[1];
    await app.inject({
      method: "POST",
      url: "/api/stars",
      headers: { cookie },
      payload: { cardId: pick, starred: true, changedAt: Math.floor(Date.now() / 1000) },
    });

    const after = (
      await app.inject({ method: "GET", url: "/api/queue?limit=5", headers: { cookie } })
    ).json();
    assert.deepEqual(after.starred, [pick]);
    await app.close();
  });

  it("drops a card from the queue's starred list once it is unstarred (#22)", async () => {
    // card_stars now keeps one row per (user, card) forever and flips its
    // `starred` column instead of being deleted (that is what makes the LWW
    // comparison possible). starredAmong() must filter on that column, not
    // on row presence, or an unstarred card would keep reporting as starred.
    const { app, config } = await fixture();
    const cookie = await signIn(app, config);

    const { cardIds } = (
      await app.inject({ method: "GET", url: "/api/queue?limit=5", headers: { cookie } })
    ).json();
    const pick = cardIds[1];

    await app.inject({
      method: "POST",
      url: "/api/stars",
      headers: { cookie },
      payload: { cardId: pick, starred: true, changedAt: Math.floor(Date.now() / 1000) },
    });
    await app.inject({
      method: "POST",
      url: "/api/stars",
      headers: { cookie },
      payload: { cardId: pick, starred: false, changedAt: Math.floor(Date.now() / 1000) + 1 },
    });

    const after = (
      await app.inject({ method: "GET", url: "/api/queue?limit=5", headers: { cookie } })
    ).json();
    assert.deepEqual(after.starred, [], "the row still exists, but starred = 0 must not leak through");
    await app.close();
  });

  it("does not leak another user's stars into the queue", async () => {
    const { app, db, config } = await fixture();
    await seedUser(db, { handle: "someone", pin: "111111", display: "Someone" });

    const mine = await signIn(app, config);
    const theirs = await signIn(app, config, { handle: "someone", pin: "111111" });

    const ids = (
      await app.inject({ method: "GET", url: "/api/queue?limit=5", headers: { cookie: theirs } })
    ).json().cardIds;
    await app.inject({
      method: "POST",
      url: "/api/stars",
      headers: { cookie: theirs },
      payload: { cardId: ids[0], starred: true, changedAt: Math.floor(Date.now() / 1000) },
    });

    const body = (
      await app.inject({ method: "GET", url: "/api/queue?limit=5", headers: { cookie: mine } })
    ).json();
    assert.deepEqual(body.starred, [], "her queue shows her stars, not someone else's");
    await app.close();
  });

  it("rejects a filter value it does not know", async () => {
    const { app, config } = await fixture();
    const cookie = await signIn(app, config);
    for (const url of ["/api/queue?only=everything", "/api/queue?mode=guess", "/api/queue?limit=999"]) {
      assert.equal((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode, 400, url);
    }
    await app.close();
  });

  it("POST /api/stars pins a card and 404s an unknown one", async () => {
    const { app, config } = await fixture();
    const cookie = await signIn(app, config);

    const ok = await app.inject({
      method: "POST", url: "/api/stars", headers: { cookie },
      payload: { cardId: 4, starred: true, changedAt: Math.floor(Date.now() / 1000) },
    });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json(), { ok: true, cardId: 4, starred: true });

    const missing = await app.inject({
      method: "POST", url: "/api/stars", headers: { cookie },
      payload: { cardId: 9999, starred: true, changedAt: Math.floor(Date.now() / 1000) },
    });
    assert.equal(missing.statusCode, 404);
    await app.close();
  });
});

describe("how many cards the filters match (design 36)", () => {
  it("counts past the session cap", async () => {
    // The sheet's button reads "Start 20 of 34": the cap is what she will
    // practise, `available` is what there is. Returning only the capped list
    // would make the two numbers the same and the sentence pointless.
    const db = openDatabase(":memory:");
    const user = await seedUser(db);
    seedCards(db, 40);

    const answer = queueForUser(db, user.id, { limit: 10 });
    assert.equal(answer.cardIds.length, 10);
    assert.ok(answer.available > 10, `available was ${answer.available}`);
    db.close();
  });

  it("counts what the filter matches, not the whole deck", async () => {
    const db = openDatabase(":memory:");
    const user = await seedUser(db);
    seedCards(db, 40);
    db.prepare("INSERT INTO tags (card_id, tag) VALUES (1, 'food'), (2, 'food')").run();

    // A filtered session is never capped by the daily new-card limit (§5a),
    // so both of these are reachable.
    assert.equal(queueForUser(db, user.id, { tag: "food", limit: 60 }).available, 2);
    db.close();
  });
});

describe("a deck's progress in Noji's three bands (#159)", () => {
  it("counts the whole deck, and splits today's reviews the same way", async () => {
    const { db, user } = await fixture();
    // Kaishi is cards 1–30 here. Two are due: one the scheduler had put three
    // weeks out (mastered), one five days out (in progress).
    setState(db, user.id, 1, { dueAt: NOW - 60, lastReview: NOW - 30 * DAY });
    setState(db, user.id, 2, { dueAt: NOW - 60, lastReview: NOW - 5 * DAY });
    // Not due: one mastered, one still in its first day.
    setState(db, user.id, 3, { dueAt: NOW + 10 * DAY, lastReview: NOW - 25 * DAY });
    setState(db, user.id, 4, { dueAt: NOW + 3600, lastReview: NOW - 3600 });
    // Someone else's state is not her progress.
    const other = await seedUser(db, { handle: "yui" });
    setState(db, other.id, 5, { dueAt: NOW + 100 * DAY, lastReview: NOW - 100 * DAY });

    const answer = queueForUser(db, user.id, { deckKey: "kaishi" }, NOW);
    assert.deepEqual(answer.progress, { total: 30, new: 26, learning: 2, mastered: 2 });
    assert.equal(answer.today.review, 2);
    assert.equal(answer.today.learning, 1);
    assert.equal(answer.today.mastered, 1);
    assert.equal(answer.today.total, answer.today.fresh + answer.today.learning + answer.today.mastered);

    // A topic narrows the session, not the deck's progress.
    assert.deepEqual(queueForUser(db, user.id, { deckKey: "kaishi", tag: "school" }, NOW).progress, answer.progress);
    // Without a deck there is no deck to describe.
    assert.equal(queueForUser(db, user.id, {}, NOW).progress, undefined);
    db.close();
  });
});
