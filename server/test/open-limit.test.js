import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { startOfDay } from "../src/day.js";
import { releaseNewCards, updateDeckSettings } from "../src/deck-settings.js";
import { ingestEvents } from "../src/events.js";
import { OPEN_DAYS, queueForUser } from "../src/queue.js";
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
  const insert = db.prepare("INSERT INTO cards (id, word, word_meaning, frequency_rank, deck) VALUES (?, ?, ?, ?, 'kaishi')");
  for (let i = 1; i <= cards; i++) insert.run(i, `語${i}`, `word ${i}`, i);
  db.prepare("INSERT INTO deck_settings (user_id, deck_key, new_per_day, updated_at) VALUES (?, 'kaishi', 10, 0)").run(user.id);
  return { db, userId: user.id };
}

const answer = (db, userId, ids, rating, at) =>
  ingestEvents(db, userId, ids.map((card_id, i) => ({ id: randomUUID(), card_id, mode: "flip", rating, reviewed_at: at + i })), at + ids.length, TZ);

const queue = (db, userId, now) => queueForUser(db, userId, { deckKey: "kaishi", timeZone: TZ }, now);

describe("Höchstens gleichzeitig lernen (#314)", () => {
  it("changes nothing without the setting", async () => {
    const { db, userId } = await learner();
    answer(db, userId, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2, D1);
    const q = queue(db, userId, D2);
    assert.equal(q.today.fresh, 10);
    assert.equal(q.openLimit, undefined);
  });

  it("holds new cards back while that many are open, and says so", async () => {
    const { db, userId } = await learner();
    updateDeckSettings(db, userId, "kaishi", { maxOpen: 10 });
    answer(db, userId, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2, D1);
    const q = queue(db, userId, D2);
    assert.equal(q.today.fresh, 0);
    assert.deepEqual(q.openLimit, { open: 10, max: 10 });
    assert.equal(q.newCapReached, true);
  });

  it("lets in only as many as there is room for", async () => {
    const { db, userId } = await learner();
    updateDeckSettings(db, userId, "kaishi", { maxOpen: 10 });
    answer(db, userId, [1, 2, 3, 4, 5, 6], 2, D1);
    assert.equal(queue(db, userId, D2).today.fresh, 4);
  });

  it(`stops counting a card once it is ${OPEN_DAYS} days apart`, async () => {
    const { db, userId } = await learner();
    updateDeckSettings(db, userId, "kaishi", { maxOpen: 10 });
    // Leicht, then Leicht again days later: well past a week apart.
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    answer(db, userId, ids, 4, D1);
    answer(db, userId, ids, 4, D1 + 5 * DAY);
    const q = queue(db, userId, D1 + 6 * DAY);
    assert.equal(q.today.fresh, 10);
    assert.equal(q.openLimit, undefined);
  });

  it("gives way to what she releases on the deck page (#179)", async () => {
    const { db, userId } = await learner();
    updateDeckSettings(db, userId, "kaishi", { maxOpen: 10 });
    answer(db, userId, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2, D1);
    releaseNewCards(db, userId, "kaishi", "2026-10-06");
    assert.equal(queue(db, userId, D2).today.fresh, 10);
  });

  it("does not hold back a set she chose", async () => {
    const { db, userId } = await learner();
    updateDeckSettings(db, userId, "kaishi", { maxOpen: 10 });
    answer(db, userId, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2, D1);
    const q = queueForUser(db, userId, { deckKey: "kaishi", only: "new", timeZone: TZ }, D2);
    assert.ok(q.cardIds.length > 0);
  });

  it("is set and cleared through the options sheet's route, within its bounds", async () => {
    const { app, db, config } = await testApp();
    await seedUser(db);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { handle: "mira", pin: "483920" } });
    const cookie = `${config.cookieName}=${cookieValue(login.headers["set-cookie"], config.cookieName)}`;
    const patch = (body) => app.inject({ method: "PATCH", url: "/api/decks/settings", headers: { cookie }, payload: body });

    const set = await patch({ deckKey: "kaishi", maxOpen: 50 });
    assert.equal(set.statusCode, 200);
    assert.equal(set.json().settings.maxOpen, 50);
    // Another change leaves it as it is.
    assert.equal((await patch({ deckKey: "kaishi", newPerDay: 10 })).json().settings.maxOpen, 50);
    assert.equal((await patch({ deckKey: "kaishi", maxOpen: null })).json().settings.maxOpen, null);
    assert.equal((await patch({ deckKey: "kaishi", maxOpen: 5 })).statusCode, 400);
    await app.close();
  });
});
