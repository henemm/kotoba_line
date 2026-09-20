import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

/**
 * #252: Settings → Einstieg. The deck list becomes Reise 1, and Reise 2 once
 * every Reise 1 card was said aloud and known once.
 */
describe("Einstieg (#252)", () => {
  // Cards 1–4 are Reise 1, 5–6 Reise 2, 7–8 only Kaishi.
  async function signedIn({ beginner = true } = {}) {
    const { app, db, config } = await testApp();
    await seedUser(db);
    seedCards(db, 8);
    const tag = db.prepare("INSERT INTO tags (card_id, tag) VALUES (?, ?)");
    for (const id of [1, 2, 3, 4]) tag.run(id, "travel 1");
    for (const id of [5, 6]) tag.run(id, "travel 2");
    const cookie = await signIn(app, config);
    const call = async (method, url, payload) =>
      (await app.inject({ method, url, headers: { cookie }, payload })).json();
    if (beginner) await call("PATCH", "/api/settings", { beginner: true });
    const answer = (card_id, rating, mode = "speak", at = Math.floor(Date.now() / 1000) - 3600) =>
      call("POST", "/api/events", { events: [{ id: randomUUID(), card_id, mode, rating, reviewed_at: at }] });
    return { app, db, call, answer };
  }

  it("is off for an account that never touched it, which keeps every deck", async () => {
    const { app, call } = await signedIn({ beginner: false });
    assert.equal((await call("GET", "/api/settings")).settings.beginner, false);
    assert.deepEqual((await call("GET", "/api/decks")).decks.map((d) => d.key), ["kaishi"]);
    await app.close();
  });

  it("lists Reise 1 and a locked Reise 2, offering three ways of practising", async () => {
    const { app, call } = await signedIn();
    const [one, two] = (await call("GET", "/api/decks")).decks;
    assert.equal(one.key, "travel:1");
    assert.equal(one.name, "Reise 1");
    assert.equal(one.cards, 4);
    assert.equal(one.known, 0);
    assert.equal(one.locked, undefined);
    assert.deepEqual(one.ways, { choose: 4, listen: 0, speak: 4, type: 0, flip: 4 });
    // Hidden, not impossible: Optionen can still switch the other two on.
    assert.deepEqual(one.settings.hiddenModes, ["listen", "type"]);
    assert.equal(two.key, "travel:2");
    assert.equal(two.locked, true);
    assert.equal(two.today.total, 0);
    await app.close();
  });

  it("asks only Reise 1's cards, paced by its own daily limit", async () => {
    const { app, call } = await signedIn();
    const queue = await call("GET", "/api/queue?deckKey=travel:1&limit=60");
    assert.deepEqual([...queue.cardIds].sort(), [1, 2, 3, 4]);
    assert.equal(queue.filtered, false, "a deck, not a chosen set: the daily limit holds");
    assert.deepEqual(queue.progress, { total: 4, new: 4, learning: 0, mastered: 0 });
    await app.close();
  });

  it("unlocks Reise 2 once every Reise 1 card was known aloud — not chosen, not after a peek", async () => {
    const { app, call, answer } = await signedIn();
    for (const id of [1, 2, 3]) await answer(id, 3);
    await answer(4, 3, "choose"); // knowing the meaning is not saying it
    await answer(4, 1); // "Romaji zeigen" grades Nochmal
    let [one, two] = (await call("GET", "/api/decks")).decks;
    assert.equal(one.known, 3);
    assert.equal(two.locked, true);

    await answer(4, 3);
    [one, two] = (await call("GET", "/api/decks")).decks;
    assert.equal(one.known, 4);
    assert.equal(two.locked, undefined);
    assert.equal(two.today.total, 2);

    // A later Nochmal does not lock it again.
    await answer(1, 1, "speak", Math.floor(Date.now() / 1000) - 60);
    [, two] = (await call("GET", "/api/decks")).decks;
    assert.equal(two.locked, undefined);
    await app.close();
  });

  it("keeps settings for Reise decks, which the old CHECK refused (migration 031)", async () => {
    const { app, call } = await signedIn();
    const res = await call("PATCH", "/api/decks/settings", { deckKey: "travel:1", newPerDay: 5 });
    assert.equal(res.settings?.newPerDay ?? res.newPerDay, 5, JSON.stringify(res));
    const one = (await call("GET", "/api/decks")).decks[0];
    assert.equal(one.settings.newPerDay, 5);
    await app.close();
  });

  it("gives every deck back when switched off, with nothing lost", async () => {
    const { app, call, answer } = await signedIn();
    await answer(1, 3);
    await call("PATCH", "/api/settings", { beginner: false });
    const decks = (await call("GET", "/api/decks")).decks;
    assert.deepEqual(decks.map((d) => d.key), ["kaishi"]);
    assert.equal(decks[0].seen, 1);
    await app.close();
  });
});
