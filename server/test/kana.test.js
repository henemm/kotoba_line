import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { writeKanaCards } from "../../import/import-kana.js";
import { kanaId } from "../../import/lib/kana.js";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

describe("the kana decks (#158)", () => {
  async function signedIn({ kana = true } = {}) {
    const { app, db, config } = await testApp();
    await seedUser(db);
    seedCards(db, 3);
    if (kana) writeKanaCards(db, 1000);
    const cookie = await signIn(app, config);
    const get = async (url) => (await app.inject({ method: "GET", url, headers: { cookie } })).json();
    return { app, db, cookie, get };
  }

  it("lists Hiragana and Katakana after Kaishi, asking only the two ways a kana can be asked", async () => {
    const { app, get } = await signedIn();
    const { decks } = await get("/api/decks");
    assert.deepEqual(decks.map((d) => d.key), ["kaishi", "hiragana", "katakana"]);
    const hiragana = decks[1];
    assert.equal(hiragana.name, "Hiragana");
    assert.equal(hiragana.own, false);
    assert.equal(hiragana.cards, 104);
    assert.deepEqual(hiragana.ways, { choose: 104, listen: 0, speak: 0, type: 0, flip: 104 });
    assert.deepEqual(hiragana.settings, { hiddenModes: [], newPerDay: 5, maxPerDay: null });
    assert.deepEqual(hiragana.today, { total: 5, fresh: 5, review: 0, learning: 0, mastered: 0 });
    await app.close();
  });

  it("is not listed before the kana import", async () => {
    const { app, get } = await signedIn({ kana: false });
    assert.deepEqual((await get("/api/decks")).decks.map((d) => d.key), ["kaishi"]);
    await app.close();
  });

  it("brings the first row first: あいうえお", async () => {
    const { app, get } = await signedIn();
    const queue = await get("/api/queue?deckKey=hiragana&limit=60");
    assert.deepEqual([...queue.cardIds].sort(), ["あ", "い", "う", "え", "お"].map(kanaId).sort());
    assert.deepEqual(queue.progress, { total: 104, new: 104, learning: 0, mastered: 0 });
    await app.close();
  });

  it("keeps its own settings, which the old CHECK refused (migration 018)", async () => {
    const { app, cookie, get } = await signedIn();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/decks/settings",
      headers: { cookie },
      payload: { deckKey: "katakana", newPerDay: 10 },
    });
    assert.equal(res.statusCode, 200, res.body);
    const katakana = (await get("/api/decks")).decks.find((d) => d.key === "katakana");
    assert.equal(katakana.settings.newPerDay, 10);
    assert.equal(katakana.today.fresh, 10);
    const hiragana = (await get("/api/decks")).decks.find((d) => d.key === "hiragana");
    assert.equal(hiragana.settings.newPerDay, 5, "one deck's setting is not the other's");
    await app.close();
  });

  it("stays out of Search, which finds words", async () => {
    const { app, get } = await signedIn();
    const found = await get("/api/browse?q=ka");
    assert.equal(found.cards.filter((c) => c.deck === "hiragana" || c.deck === "katakana").length, 0);
    await app.close();
  });

  it("reaches the phone with the rest of the deck", async () => {
    const { app, get } = await signedIn();
    const deck = await get("/api/deck?since=0");
    const a = deck.cards.find((c) => c.id === kanaId("あ"));
    assert.equal(a.word, "あ");
    assert.equal(a.word_meaning, "a");
    assert.equal(a.deck, "hiragana");
    await app.close();
  });
});
