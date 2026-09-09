import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_SESSION_LENGTH,
  browseCards,
  composeQueue,
  isFiltered,
  queueForUser,
  setStar,
  shuffle,
} from "../src/queue.js";
import { ingestEvents } from "../src/events.js";
import { seedUser, signIn, testApp } from "./helpers.js";

const DAY = 86400;
const NOW = 1_760_000_000;
const uid = (n) => `9f8e7d6c-5b4a-4321-8765-${String(n).padStart(12, "0")}`;

/** A deck with enough shape to exercise the filters. */
function seedDeck(db) {
  const card = db.prepare(
    `INSERT INTO cards (id, word, word_meaning, frequency_rank, deck, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const tag = db.prepare("INSERT INTO tags (card_id, tag) VALUES (?, ?)");

  for (let i = 1; i <= 40; i++) {
    card.run(i, `語${i}`, `word ${i}`, i, i > 30 ? "personal" : "kaishi", NOW - DAY);
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

async function fixture() {
  const { app, db, config } = await testApp();
  const user = await seedUser(db);
  seedDeck(db);
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
  it("is any filter at all", () => {
    assert.equal(isFiltered({}), false);
    assert.equal(isFiltered({ deck: "personal" }), true);
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
    const q = queueForUser(db, user.id, { limit: 40 }, NOW, () => 0);
    assert.ok(q.cardIds.includes(31), "a fresh lapse comes back regardless of due date");
    await app.close();
  });

  it("leaves an old lapse alone", async () => {
    const { app, db, user } = await fixture();
    setState(db, user.id, 31, { dueAt: NOW + 10 * DAY, lapses: 2, lastReview: NOW - 10 * DAY });
    const q = queueForUser(db, user.id, { limit: 40 }, NOW, () => 0);
    assert.ok(!q.cardIds.includes(31));
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

    const chosen = queueForUser(db, user.id, { deck: "personal", limit: 40 }, NOW, () => 0);
    assert.ok(chosen.cardIds.length > 0, "a chosen session still has cards");
    assert.equal(chosen.filtered, true);
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
});

describe("the endpoints", () => {
  it("all need a session", async () => {
    const { app } = await fixture();
    for (const url of ["/api/deck", "/api/queue", "/api/browse"]) {
      assert.equal((await app.inject({ method: "GET", url })).statusCode, 401, url);
    }
    assert.equal(
      (await app.inject({ method: "POST", url: "/api/stars", payload: { cardId: 1, starred: true } }))
        .statusCode,
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

  it("GET /api/queue returns ids only", async () => {
    const { app, config } = await fixture();
    const cookie = await signIn(app, config);
    const body = (await app.inject({ method: "GET", url: "/api/queue?limit=5", headers: { cookie } })).json();
    assert.equal(body.cardIds.length, 5);
    assert.ok(body.cardIds.every((id) => typeof id === "number"), "ids, not card content");
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
      payload: { cardId: 4, starred: true },
    });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json(), { ok: true, cardId: 4, starred: true });

    const missing = await app.inject({
      method: "POST", url: "/api/stars", headers: { cookie },
      payload: { cardId: 9999, starred: true },
    });
    assert.equal(missing.statusCode, 404);
    await app.close();
  });
});
