import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { openDatabase } from "../src/db.js";
import { startOfDay } from "../src/day.js";
import { releaseNewCards } from "../src/deck-settings.js";
import { ingestEvents } from "../src/events.js";
import { AGAIN_PER_DAY, OPEN_DAYS, queueForUser } from "../src/queue.js";
import { updateSettings } from "../src/settings.js";
import { previewIntervals, stateFromEvents } from "../src/scheduler.js";
import { cookieValue, seedUser, testApp } from "./helpers.js";

/**
 * #314. Charlotte, 2026-10-04: 100–150 cards a day, and new ones keep coming.
 * Two causes, two changes: Schwer kept a learning card on its 8-minute step
 * however many days passed (93 of her cards, 85 % of a week's answers), and
 * nothing held new cards back while many were still open.
 */

const TZ = "Asia/Tokyo";
const DAY = 86400;
// 10:00 in Tokyo on three consecutive days.
const D1 = startOfDay("2026-10-05", TZ) + 10 * 3600;
const D2 = D1 + DAY;
const D3 = D2 + DAY;
const ev = (id, rating, reviewed_at) => ({ id, rating, reviewed_at, time_zone: TZ });

describe("Schwer on a learning card (#314)", () => {
  it("keeps the 8-minute step on the day the card is met", () => {
    const state = stateFromEvents([ev("a", 2, D1), ev("b", 2, D1 + 600)]);
    assert.ok(state.due_at - state.last_review < 3600, "still a learning step");
  });

  it("takes the card out of its steps on a later day", () => {
    const state = stateFromEvents([ev("a", 2, D1), ev("b", 2, D2)]);
    assert.ok(state.due_at - state.last_review >= DAY, `${state.due_at - state.last_review} s`);
  });

  it("does so also for a card she once forgot (relearning)", () => {
    // Gut until review state, a Nochmal, then Schwer the next day.
    const state = stateFromEvents([ev("a", 3, D1), ev("b", 3, D1 + 900), ev("c", 1, D3), ev("d", 2, D3 + DAY)]);
    assert.ok(state.due_at - state.last_review >= DAY);
  });

  it("counts days by her midnight, not 24 hours", () => {
    // 23:50 and 00:10 the next night are two of her days.
    const late = startOfDay("2026-10-05", TZ) + DAY - 600;
    const state = stateFromEvents([ev("a", 2, late), ev("b", 2, late + 1200)]);
    assert.ok(state.due_at - state.last_review >= DAY);
  });

  it("says under the button what it then does", () => {
    const events = [ev("a", 2, D1)];
    const label = previewIntervals(events, new Date(D2 * 1000), TZ)[2];
    const after = stateFromEvents([...events, ev("b", 2, D2)]);
    assert.equal(label, after.due_at - D2);
    // …and on the first day still the step.
    assert.ok(previewIntervals(events, new Date((D1 + 600) * 1000), TZ)[2] < 3600);
  });

  it("leaves Nochmal, Gut and Leicht as they were", () => {
    for (const rating of [1, 3]) {
      const state = stateFromEvents([ev("a", 1, D1), ev("b", rating, D2)]);
      assert.ok(state.due_at - state.last_review < DAY, `rating ${rating}`);
    }
  });
});

async function learner(cards = 40) {
  const db = openDatabase(":memory:");
  const user = await seedUser(db);
  const insert = db.prepare("INSERT INTO cards (id, word, word_meaning, frequency_rank, deck) VALUES (?, ?, ?, ?, ?)");
  for (let i = 1; i <= cards; i++) insert.run(i, `語${i}`, `word ${i}`, i, "kaishi");
  // A second deck, for the limit that counts every deck together.
  for (let i = 1; i <= 20; i++) insert.run(1000 + i, `あ${i}`, `kana ${i}`, i, "hiragana");
  db.prepare("INSERT INTO deck_settings (user_id, deck_key, new_per_day, updated_at) VALUES (?, 'kaishi', 10, 0)").run(user.id);
  db.prepare("INSERT INTO deck_settings (user_id, deck_key, new_per_day, updated_at) VALUES (?, 'hiragana', 10, 0)").run(user.id);
  return { db, userId: user.id };
}

const answer = (db, userId, ids, rating, at) =>
  ingestEvents(db, userId, ids.map((card_id, i) => ({ id: randomUUID(), card_id, mode: "flip", rating, reviewed_at: at + i })), at + ids.length, TZ);

const queue = (db, userId, now, deckKey = "kaishi", extra = {}) => queueForUser(db, userId, { deckKey, timeZone: TZ, ...extra }, now);
const limitAt = (db, userId, n) => updateSettings(db, userId, { maxOpen: n });
const TEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("Höchstens gleichzeitig lernen, every deck together (#314)", () => {
  it("changes nothing without the setting", async () => {
    const { db, userId } = await learner();
    answer(db, userId, TEN, 2, D1);
    const q = queue(db, userId, D2);
    assert.equal(q.today.fresh, 10);
    assert.equal(q.openLimit, undefined);
  });

  it("holds new cards back while that many are open, and says so", async () => {
    const { db, userId } = await learner();
    limitAt(db, userId, 10);
    answer(db, userId, TEN, 2, D1);
    const q = queue(db, userId, D2);
    assert.equal(q.today.fresh, 0);
    assert.deepEqual(q.openLimit, { open: 10, max: 10 });
    assert.equal(q.newCapReached, true);
  });

  it("counts cards open in another deck", async () => {
    const { db, userId } = await learner();
    limitAt(db, userId, 10);
    // Ten open in Kaishi: Hiragana brings no new characters either.
    answer(db, userId, TEN, 2, D1);
    assert.equal(queue(db, userId, D2, "hiragana").today.fresh, 0);
  });

  it("lets in only as many as there is room for", async () => {
    const { db, userId } = await learner();
    limitAt(db, userId, 10);
    answer(db, userId, [1, 2, 3, 4, 5, 6], 2, D1);
    assert.equal(queue(db, userId, D2).today.fresh, 4);
  });

  it(`stops counting a card once it is ${OPEN_DAYS} days apart`, async () => {
    const { db, userId } = await learner();
    limitAt(db, userId, 10);
    answer(db, userId, TEN, 4, D1);
    answer(db, userId, TEN, 4, D1 + 5 * DAY);
    const q = queue(db, userId, D1 + 6 * DAY);
    assert.equal(q.today.fresh, 10);
    assert.equal(q.openLimit, undefined);
  });

  it("gives way to what she releases on the deck page (#179)", async () => {
    const { db, userId } = await learner();
    limitAt(db, userId, 10);
    answer(db, userId, TEN, 2, D1);
    releaseNewCards(db, userId, "kaishi", "2026-10-06");
    assert.equal(queue(db, userId, D2).today.fresh, 10);
  });

  it("holds „Nochmal üben“ to it too — its few new cards were how 15 got past it", async () => {
    const { db, userId } = await learner();
    limitAt(db, userId, 10);
    answer(db, userId, TEN, 2, D1);
    const q = queue(db, userId, D2, "kaishi", { only: "again", cards: [1, 2] });
    assert.deepEqual([...q.cardIds].sort((a, b) => a - b), [1, 2]);
  });

  it("does not hold back a set she chose", async () => {
    const { db, userId } = await learner();
    limitAt(db, userId, 10);
    answer(db, userId, TEN, 2, D1);
    assert.ok(queue(db, userId, D2, "kaishi", { only: "new" }).cardIds.length > 0);
  });

  it("moved from her deck to her account (migration 040)", () => {
    // Everything up to 039, as the server stood with v176.
    const db = new Database(":memory:");
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (file >= "040") break;
      db.exec(readFileSync(new URL(file, dir), "utf8"));
    }
    db.prepare("INSERT INTO users (id, handle, display, pin_hash, created_at) VALUES (1, 'c', 'C', 'x', 0)").run();
    db.prepare("INSERT INTO user_settings (user_id) VALUES (1)").run();
    db.prepare("INSERT INTO deck_settings (user_id, deck_key, max_open, updated_at) VALUES (1, 'kaishi', 50, 0)").run();
    db.exec(readFileSync(new URL("040_max_open_all_decks.sql", dir), "utf8"));
    assert.equal(db.prepare("SELECT max_open FROM user_settings WHERE user_id = 1").get().max_open, 50);
    assert.equal(db.prepare("SELECT max_open FROM deck_settings WHERE user_id = 1").get().max_open, null);
  });

  it("is set and cleared through Settings' route, within its bounds; a deck's options still accept a v176 shell's field", async () => {
    const { app, db, config } = await testApp();
    await seedUser(db);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { handle: "mira", pin: "483920" } });
    const cookie = `${config.cookieName}=${cookieValue(login.headers["set-cookie"], config.cookieName)}`;
    const call = (url, body) => app.inject({ method: "PATCH", url, headers: { cookie }, payload: body });

    const set = await call("/api/settings", { maxOpen: 50 });
    assert.equal(set.statusCode, 200);
    assert.equal(set.json().settings.maxOpen, 50);
    assert.equal((await call("/api/settings", { maxOpen: null })).json().settings.maxOpen, null);
    assert.equal((await call("/api/settings", { maxOpen: 5 })).statusCode, 400);
    // v176 sends maxOpen with every deck change; refusing it would lose the rest.
    const deck = await call("/api/decks/settings", { deckKey: "kaishi", newPerDay: 10, maxOpen: null });
    assert.equal(deck.statusCode, 200);
    assert.equal(deck.json().settings.newPerDay, 10);
    await app.close();
  });
});

describe("a card rests after its third Nochmal of the day (#314)", () => {
  it(`leaves it out of every queue until tomorrow after ${AGAIN_PER_DAY}`, async () => {
    const { db, userId } = await learner();
    for (let k = 0; k < AGAIN_PER_DAY; k++) answer(db, userId, [1], 1, D1 + k * 120);
    const later = D1 + 3600;
    assert.ok(!queue(db, userId, later).cardIds.includes(1));
    assert.ok(!queue(db, userId, later, "kaishi", { only: "again", cards: [1] }).cardIds.includes(1));
    assert.ok(!queue(db, userId, later, "kaishi", { only: "lapsed" }).cardIds.includes(1));
    // Tomorrow it is back.
    assert.ok(queue(db, userId, D2).cardIds.includes(1));
  });

  it("keeps it while it has had fewer, and says how many", async () => {
    const { db, userId } = await learner();
    answer(db, userId, [1], 1, D1);
    answer(db, userId, [1], 1, D1 + 120);
    const q = queue(db, userId, D1 + 600);
    assert.ok(q.cardIds.includes(1));
    assert.equal(q.againToday[1], AGAIN_PER_DAY - 1);
  });

  it("counts Nochmal from yesterday for nothing", async () => {
    const { db, userId } = await learner();
    for (let k = 0; k < AGAIN_PER_DAY; k++) answer(db, userId, [1], 1, D1 + k * 120);
    const q = queue(db, userId, D2);
    assert.ok(q.cardIds.includes(1));
    assert.equal(q.againToday[1], undefined);
  });
});

describe("Ganzes Deck üben (#320)", () => {
  it("brings every card of the deck, due or not, seen or not", async () => {
    const { db, userId } = await learner(5);
    // Leicht: four days off, so none of these is due tomorrow.
    answer(db, userId, [1, 2, 3], 4, D1);
    const q = queue(db, userId, D2, "kaishi", { only: "all" });
    assert.deepEqual([...q.cardIds].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  });

  it("brings the cards resting after three Nochmal too — v179 left them out and she missed them", async () => {
    const { db, userId } = await learner(5);
    for (let k = 0; k < AGAIN_PER_DAY; k++) answer(db, userId, [1], 1, D1 + k * 120);
    assert.ok(queue(db, userId, D1 + 3600, "kaishi", { only: "all" }).cardIds.includes(1));
  });

  it("walks past the open limit, as her own choice", async () => {
    const { db, userId } = await learner(15);
    limitAt(db, userId, 10);
    answer(db, userId, TEN, 2, D1);
    assert.equal(queue(db, userId, D2, "kaishi", { only: "all" }).cardIds.length, 15);
  });

  it("stays inside the deck", async () => {
    const { db, userId } = await learner(3);
    assert.equal(queue(db, userId, D2, "hiragana", { only: "all" }).cardIds.every((id) => id > 1000), true);
  });
});
