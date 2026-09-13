import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

/**
 * Her own words belong to her (#84), and she can change them (#85).
 *
 * The first describe is the production reproduction from 2026-09-13, as a
 * test: account A adds a word, and account B must not meet it anywhere. Before
 * `cards.owner_id` B had it in the list, the queue, the cached deck and the
 * topic chips, and could delete it.
 */

const uid = (n) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;

async function twoAccounts() {
  const { app, db, config } = await testApp();
  await seedUser(db, { handle: "a", pin: "111111", display: "A" });
  await seedUser(db, { handle: "b", pin: "222222", display: "B" });
  seedCards(db, 3);
  db.prepare("UPDATE cards SET updated_at = 1").run();
  const a = await signIn(app, config, { handle: "a", pin: "111111" });
  const b = await signIn(app, config, { handle: "b", pin: "222222" });

  const call = (cookie, method, url, payload) =>
    app.inject({ method, url, headers: { cookie }, payload });
  const json = async (cookie, method, url, payload) => (await call(cookie, method, url, payload)).json();

  const { card } = await json(a, "POST", "/api/cards", {
    word: "焼き鳥",
    reading: "やきとり",
    meaning: "grilled chicken skewer",
    tags: ["izakaya"],
  });
  return { app, db, a, b, card, call, json };
}

describe("someone else's own word (#84)", () => {
  it("is not in her list, and its topic is not in her chips", async () => {
    const { app, a, b, json } = await twoAccounts();

    const theirs = await json(a, "GET", "/api/cards");
    assert.deepEqual(theirs.cards.map((c) => c.word), ["焼き鳥"]);
    assert.ok(theirs.tags.some((t) => t.tag === "izakaya"));

    const mine = await json(b, "GET", "/api/cards");
    assert.deepEqual(mine.cards, []);
    assert.ok(!mine.tags.some((t) => t.tag === "izakaya"), "their topic is not offered to her");
    await app.close();
  });

  it("is not in her queue, filtered or not", async () => {
    const { app, b, card, json } = await twoAccounts();
    for (const url of ["/api/queue?deck=personal", "/api/queue?only=new", "/api/queue", "/api/queue?tag=izakaya"]) {
      const q = await json(b, "GET", url);
      assert.ok(!q.cardIds.includes(card.id), url);
    }
    await app.close();
  });

  it("is not in browse, and does not count towards its total", async () => {
    const { app, b, card, json } = await twoAccounts();
    const all = await json(b, "GET", "/api/browse");
    assert.ok(!all.cards.some((c) => c.id === card.id));
    assert.equal(all.total, 3, "the three shared cards and nothing else");
    assert.equal((await json(b, "GET", "/api/browse?q=%E7%84%BC")).total, 0);
    await app.close();
  });

  it("reaches her device only as a deletion, with nothing of the word in it", async () => {
    // A tombstone rather than an omission: a device that cached the word
    // before cards had owners has to be told to drop it.
    const { app, a, b, card, json } = await twoAccounts();

    const hers = await json(b, "GET", "/api/deck?since=0");
    const row = hers.cards.find((c) => c.id === card.id);
    assert.ok(row, "sent");
    assert.ok(row.deleted_at, "as a deletion");
    assert.equal(row.word, undefined);
    assert.equal(row.word_meaning, undefined);
    assert.equal(JSON.stringify(row).includes("焼き鳥"), false);
    assert.equal(hers.total, 4, "paging counts the same rows it sends");

    const theirs = await json(a, "GET", "/api/deck?since=0");
    const own = theirs.cards.find((c) => c.id === card.id);
    assert.equal(own.word, "焼き鳥");
    assert.equal(own.deleted_at, null);
    assert.deepEqual(own.tags, ["izakaya"]);
    assert.equal(own.owner_id, undefined, "the owner column stays on the server");
    await app.close();
  });

  it("cannot be deleted, edited, starred, tagged or reviewed by her", async () => {
    const { app, db, b, card, call } = await twoAccounts();

    assert.equal((await call(b, "DELETE", `/api/cards/${card.id}`)).statusCode, 404);
    assert.equal(
      (await call(b, "PUT", `/api/cards/${card.id}`, { word: "x", meaning: "y" })).statusCode,
      404,
    );
    const now = Math.floor(Date.now() / 1000);
    assert.equal(
      (await call(b, "POST", "/api/stars", { cardId: card.id, starred: true, changedAt: now })).statusCode,
      404,
    );
    assert.equal(
      (await call(b, "PUT", `/api/cards/${card.id}/tags`, { tags: ["mine"] })).statusCode,
      404,
    );
    const events = (
      await call(b, "POST", "/api/events", {
        events: [{ id: uid(1), card_id: card.id, mode: "choose", rating: 3, reviewed_at: now }],
      })
    ).json();
    assert.deepEqual(events.rejected, [{ id: uid(1), reason: "unknown_card" }]);

    const row = db.prepare("SELECT word, deleted_at FROM cards WHERE id = ?").get(card.id);
    assert.deepEqual({ ...row }, { word: "焼き鳥", deleted_at: null }, "untouched");
    await app.close();
  });

  it("is not in her stats topics or her Settings deck count", async () => {
    const { app, a, b, json } = await twoAccounts();

    const statsB = await json(b, "GET", "/api/stats");
    assert.ok(!statsB.topics.some((t) => t.tag === "izakaya"));

    const settingsA = await json(a, "GET", "/api/settings");
    const settingsB = await json(b, "GET", "/api/settings");
    const personal = (s) => s.decks.find((d) => d.key === "personal").cards;
    assert.equal(personal(settingsA), 1);
    assert.equal(personal(settingsB), 0);
    await app.close();
  });
});

describe("a personal card from before cards had owners", () => {
  it("is visible to nobody, rather than to everybody", async () => {
    const { app, db, a, b, json } = await twoAccounts();
    db.prepare(
      `INSERT INTO cards (id, word, word_meaning, deck, owner_id, updated_at)
       VALUES (-5, '古い', 'old', 'personal', NULL, 2)`,
    ).run();
    for (const cookie of [a, b]) {
      assert.ok(!(await json(cookie, "GET", "/api/cards")).cards.some((c) => c.id === -5));
      assert.ok(!(await json(cookie, "GET", "/api/queue?deck=personal")).cardIds.includes(-5));
    }
    await app.close();
  });
});

describe("editing one of her own words (#85)", () => {
  it("changes the content, carries it to her other device, and keeps her history", async () => {
    const { app, db, a, card, call, json } = await twoAccounts();

    const now = Math.floor(Date.now() / 1000);
    await call(a, "POST", "/api/events", {
      events: [{ id: uid(2), card_id: card.id, mode: "flip", rating: 3, reviewed_at: now - 60 }],
    });
    const stateBefore = { ...db.prepare("SELECT * FROM card_state WHERE card_id = ?").get(card.id) };
    const { latest } = await json(a, "GET", "/api/deck?since=0");
    db.prepare("UPDATE cards SET updated_at = updated_at - 10 WHERE id = ?").run(card.id);

    const res = await call(a, "PUT", `/api/cards/${card.id}`, {
      word: "焼き鳥",
      reading: "やきとり",
      meaning: "yakitori, grilled chicken",
      sentence: "焼き鳥を食べたい。",
      sentenceMeaning: "I want to eat yakitori.",
      tags: ["food"],
    });
    assert.equal(res.statusCode, 200);
    const { card: edited } = res.json();
    assert.equal(edited.id, card.id, "same card, same id");
    assert.equal(edited.word_meaning, "yakitori, grilled chicken");
    assert.equal(edited.sentence_meaning, "I want to eat yakitori.");
    assert.deepEqual(edited.tags, ["food"], "topics replaced, not added");

    // The other device's next sync picks it up.
    const changed = await json(a, "GET", `/api/deck?since=${latest - 20}`);
    assert.equal(changed.cards.find((c) => c.id === card.id)?.word_meaning, "yakitori, grilled chicken");

    const stateAfter = { ...db.prepare("SELECT * FROM card_state WHERE card_id = ?").get(card.id) };
    assert.deepEqual(stateAfter, stateBefore, "a fixed typo is not a forgotten word");
    assert.equal(db.prepare("SELECT count(*) n FROM review_events WHERE card_id = ?").get(card.id).n, 1);
    await app.close();
  });

  it("clears an optional field she emptied", async () => {
    const { app, a, card, json } = await twoAccounts();
    const { card: edited } = await json(a, "PUT", `/api/cards/${card.id}`, {
      word: "焼き鳥",
      meaning: "grilled chicken skewer",
      reading: "",
    });
    assert.equal(edited.word_reading, null);
    assert.deepEqual(edited.tags, []);
    await app.close();
  });

  it("refuses an empty meaning, a misspelled field, and a card from the shared deck", async () => {
    const { app, a, card, call } = await twoAccounts();
    assert.equal((await call(a, "PUT", `/api/cards/${card.id}`, { word: "x", meaning: "" })).statusCode, 400);
    assert.equal(
      (await call(a, "PUT", `/api/cards/${card.id}`, { word: "x", meaning: "y", meanng: "z" })).statusCode,
      400,
    );
    assert.equal((await call(a, "PUT", "/api/cards/1", { word: "x", meaning: "y" })).statusCode, 403);
    assert.equal((await call(a, "PUT", "/api/cards/-999", { word: "x", meaning: "y" })).statusCode, 404);
    await app.close();
  });

  it("will not edit a word she already deleted", async () => {
    const { app, a, card, call } = await twoAccounts();
    await call(a, "DELETE", `/api/cards/${card.id}`);
    assert.equal(
      (await call(a, "PUT", `/api/cards/${card.id}`, { word: "x", meaning: "y" })).statusCode,
      404,
    );
    await app.close();
  });
});

describe("deleting one of her own words through the API (#85)", () => {
  it("takes it out of her list and sends her device the deletion", async () => {
    const { app, a, card, call, json } = await twoAccounts();
    assert.equal((await call(a, "DELETE", `/api/cards/${card.id}`)).statusCode, 200);
    assert.deepEqual((await json(a, "GET", "/api/cards")).cards, []);
    const row = (await json(a, "GET", "/api/deck?since=0")).cards.find((c) => c.id === card.id);
    assert.ok(row.deleted_at);
    await app.close();
  });
});
