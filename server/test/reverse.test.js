import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replayCardState } from "../src/replay.js";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

/**
 * A card asked the other way round (#284) — Noji's "Reverse": a card of its
 * own, with its own progress, whose content is always its original's.
 */

const uid = (n) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;
const DAY = 86400;

async function setup() {
  const { app, db, config } = await testApp();
  await seedUser(db, { handle: "a", pin: "111111", display: "A" });
  const a = await signIn(app, config, { handle: "a", pin: "111111" });
  const call = (method, url, payload) => app.inject({ method, url, headers: { cookie: a }, payload });
  const json = async (method, url, payload) => (await call(method, url, payload)).json();
  const { card } = await json("POST", "/api/cards", { word: "Kyoudai", meaning: "Geschwister", reverse: true });
  const deckKey = `deck:${card.deck_id}`;
  const reverseRow = () => db.prepare("SELECT * FROM cards WHERE reverse_of = ?").get(card.id);
  const answer = (cardId, n, reviewedAt, mode = "flip", rating = 3) =>
    json("POST", "/api/events", { events: [{ id: uid(n), card_id: cardId, mode, rating, reviewed_at: reviewedAt }] });
  const queue = (mode) => json("GET", `/api/queue?deckKey=${encodeURIComponent(deckKey)}${mode ? `&mode=${mode}` : ""}`);
  return { app, db, card, deckKey, call, json, reverseRow, answer, queue };
}

describe("a card with its reverse on (#284)", () => {
  it("is two cards on the phone and one word in her list", async () => {
    const { app, card, json, reverseRow } = await setup();
    const rev = reverseRow();
    assert.ok(rev.id < 0, "negative, like every card of hers");

    const { cards } = await json("GET", "/api/deck");
    const sent = cards.find((c) => c.id === rev.id);
    assert.equal(sent.reverse_of, card.id);
    assert.equal(sent.word_meaning, "Geschwister");
    assert.equal(sent.deck_id, card.deck_id);

    const list = await json("GET", "/api/cards");
    assert.deepEqual(list.cards.map((c) => [c.id, c.reverse]), [[card.id, true]]);
    assert.equal(card.reverse, true);
    await app.close();
  });

  it("follows every change to its original, and the phone is told", async () => {
    const { app, db, card, json, reverseRow } = await setup();
    db.prepare("UPDATE cards SET updated_at = 1 WHERE id IN (?, ?)").run(card.id, reverseRow().id);

    await json("PUT", `/api/cards/${card.id}`, { word: "Kyoudai", meaning: "Brüder und Schwestern", tags: ["familie"] });
    const rev = reverseRow();
    assert.equal(rev.word_meaning, "Brüder und Schwestern");
    assert.ok(rev.updated_at > 1, "updated_at moved, so the phone fetches it");
    assert.deepEqual(db.prepare("SELECT tag FROM tags WHERE card_id = ?").all(rev.id).map((r) => r.tag), ["familie"]);
    assert.equal(rev.deleted_at, null, "an edit that does not mention it leaves it on");

    // An import script writing a column in place knows nothing of reverses.
    db.prepare("UPDATE cards SET word_meaning_en = 'siblings' WHERE id = ?").run(card.id);
    assert.equal(reverseRow().word_meaning_en, "siblings");
    await app.close();
  });

  it("is not new until its original was answered on an earlier day, and then comes in めくる only", async () => {
    const { app, card, reverseRow, answer, queue } = await setup();
    const rev = reverseRow();
    const now = Math.floor(Date.now() / 1000);

    let flip = await queue("flip");
    assert.deepEqual(flip.cardIds, [card.id], "the word first, the right way round");

    // Leicht, so the original is not due again yet and the two cannot meet.
    await answer(card.id, 2, now - 2 * DAY, "flip", 4);
    flip = await queue("flip");
    assert.ok(!flip.cardIds.includes(card.id));
    assert.ok(flip.cardIds.includes(rev.id), "the day after, it is new");
    for (const mode of ["choose", "listen", "speak", "type"]) {
      assert.ok(!(await queue(mode)).cardIds.includes(rev.id), `${mode} would ask the original's question again`);
    }
    // The deck page (no mode) counts it, as Noji's 380 does.
    assert.ok((await queue()).cardIds.includes(rev.id));
    await app.close();
  });

  it("is not new on the day she met the word", async () => {
    const { app, card, reverseRow, answer, queue } = await setup();
    await answer(card.id, 1, Math.floor(Date.now() / 1000) - 60);
    assert.ok(!(await queue("flip")).cardIds.includes(reverseRow().id));
    await app.close();
  });

  it("waits while its original is in the same session — as live on 2026-09-24, 食べる after „essen“", async () => {
    const { app, card, reverseRow, answer, queue } = await setup();
    const rev = reverseRow();
    // Gut two days ago: the original is due again today, and the reverse new.
    await answer(card.id, 1, Math.floor(Date.now() / 1000) - 2 * DAY);
    const flip = await queue("flip");
    assert.ok(flip.cardIds.includes(card.id));
    assert.ok(!flip.cardIds.includes(rev.id), "the reverse would be answered by its original");
    await app.close();
  });

  it("switched off leaves as a tombstone, and switched on comes back with its history", async () => {
    const { app, db, card, json, reverseRow, answer } = await setup();
    const rev = reverseRow();
    await answer(rev.id, 3, Math.floor(Date.now() / 1000) - DAY);
    const before = db.prepare("SELECT * FROM card_state WHERE card_id = ?").get(rev.id);
    assert.equal(before.reps, 1);

    const since = db.prepare("SELECT max(updated_at) m FROM cards").get().m - 1;
    await json("PUT", `/api/cards/${card.id}`, { word: "Kyoudai", meaning: "Geschwister", reverse: false });
    const { cards } = await json("GET", `/api/deck?since=${since}`);
    assert.ok(cards.find((c) => c.id === rev.id)?.deleted_at, "the phone drops it");
    assert.equal(db.prepare("SELECT count(*) n FROM card_state WHERE card_id = ?").get(rev.id).n, 0);
    assert.equal((await json("GET", "/api/cards")).cards[0].reverse, false);

    // Changed while it was off: it has to catch up when it comes back.
    await json("PUT", `/api/cards/${card.id}`, { word: "Kyoudai", meaning: "Geschwister (alle)", reverse: true });
    const back = reverseRow();
    assert.equal(back.id, rev.id, "the same card");
    assert.equal(back.deleted_at, null);
    assert.equal(back.word_meaning, "Geschwister (alle)");
    assert.deepEqual(db.prepare("SELECT * FROM card_state WHERE card_id = ?").get(rev.id), before);
    await app.close();
  });

  it("goes with its original, and cannot be edited or deleted by itself", async () => {
    const { app, card, call, reverseRow } = await setup();
    const rev = reverseRow();
    assert.equal((await call("PUT", `/api/cards/${rev.id}`, { word: "x", meaning: "y" })).statusCode, 404);
    assert.equal((await call("DELETE", `/api/cards/${rev.id}`)).statusCode, 404);

    assert.equal((await call("DELETE", `/api/cards/${card.id}`)).statusCode, 200);
    assert.ok(reverseRow().deleted_at, "deleted with it");
    await app.close();
  });

  it("is not a second row in Search", async () => {
    const { app, card, json } = await setup();
    const { cards } = await json("GET", "/api/browse?q=kyoudai");
    assert.deepEqual(cards.map((c) => c.id), [card.id]);
    await app.close();
  });

  it("shares the word's star and her own topics, set from either direction", async () => {
    const { app, db, card, json, reverseRow } = await setup();
    const rev = reverseRow();
    const now = Math.floor(Date.now() / 1000);
    await json("POST", "/api/stars", { cardId: rev.id, starred: true, changedAt: now });
    const stars = db.prepare("SELECT card_id FROM card_stars WHERE starred = 1 ORDER BY card_id").all().map((r) => r.card_id);
    assert.deepEqual(stars.sort(), [card.id, rev.id].sort(), "starred in a session on the reverse, the word is starred");

    await json("PUT", `/api/cards/${rev.id}/tags`, { tags: ["reise"] });
    const mine = (id) => db.prepare("SELECT tag FROM card_user_tags WHERE card_id = ?").all(id).map((r) => r.tag);
    assert.deepEqual(mine(card.id), ["reise"]);
    assert.deepEqual(mine(rev.id), ["reise"]);
    await app.close();
  });

  it("rebuilds to the same state from the log, like any card (§4)", async () => {
    const { app, db, reverseRow, answer } = await setup();
    const rev = reverseRow();
    await answer(rev.id, 4, Math.floor(Date.now() / 1000) - DAY);
    const before = db.prepare("SELECT * FROM card_state WHERE card_id = ?").get(rev.id);
    replayCardState(db);
    assert.deepEqual(db.prepare("SELECT * FROM card_state WHERE card_id = ?").get(rev.id), before);
    await app.close();
  });

  it("an older phone's edit, without the field, leaves it as it is", async () => {
    const { app, card, json, reverseRow } = await setup();
    await json("PUT", `/api/cards/${card.id}`, { word: "Kyoudai", meaning: "Geschwister" });
    assert.equal(reverseRow().deleted_at, null);
    await app.close();
  });
});

describe("the other way round in every deck (#284, Henning 2026-09-24)", () => {
  async function twoOnKaishi() {
    const { app, db, config } = await testApp();
    await seedUser(db, { handle: "a", pin: "111111", display: "A" });
    await seedUser(db, { handle: "b", pin: "222222", display: "B" });
    seedCards(db, 3);
    db.prepare("INSERT INTO tags (card_id, tag) VALUES (1, 'travel 1')").run();
    const a = await signIn(app, config, { handle: "a", pin: "111111" });
    const b = await signIn(app, config, { handle: "b", pin: "222222" });
    const as = (cookie) => async (method, url, payload) =>
      (await app.inject({ method, url, headers: { cookie }, payload })).json();
    const reverseOfOne = () => db.prepare("SELECT * FROM cards WHERE reverse_of = 1 AND deleted_at IS NULL").all();
    return { app, db, A: as(a), B: as(b), reverseOfOne };
  }

  it("a Kaishi word's reverse is the switching account's alone", async () => {
    const { app, db, A, B, reverseOfOne } = await twoOnKaishi();
    assert.deepEqual(await A("POST", "/api/cards/1/reverse", { on: true }), { cardId: 1, reverse: true });
    const [rev] = reverseOfOne();
    assert.equal(rev.deck, "personal", "a card of hers, so visibleTo keeps it hers");
    assert.equal(rev.frequency_rank, 1, "in the original's place in Kaishi's order");

    const mine = await A("GET", "/api/deck");
    assert.equal(mine.cards.find((c) => c.id === rev.id).reverse_of, 1);
    const theirs = await B("GET", "/api/deck");
    const seen = theirs.cards.find((c) => c.id === rev.id);
    assert.ok(seen.deleted_at && seen.word === undefined, "a tombstone for someone else's, and nothing of it");
    assert.equal(db.prepare("SELECT count(*) n FROM cards WHERE deck = 'kaishi'").get().n, 3, "Kaishi itself is untouched");

    // Practised in Kaishi, and in Reise, whose cards are Kaishi's — by its original's topic.
    const now = Math.floor(Date.now() / 1000);
    await A("POST", "/api/events", { events: [{ id: uid(50), card_id: 1, mode: "flip", rating: 4, reviewed_at: now - 2 * DAY }] });
    assert.ok((await A("GET", "/api/queue?deckKey=kaishi&mode=flip")).cardIds.includes(rev.id));
    assert.ok((await A("GET", "/api/queue?deckKey=travel%3A1&mode=flip")).cardIds.includes(rev.id));
    assert.ok(!(await A("GET", "/api/queue?deckKey=kaishi&mode=choose")).cardIds.includes(rev.id));
    assert.ok(!(await B("GET", "/api/queue?deckKey=kaishi&mode=flip")).cardIds.includes(rev.id));

    const search = await A("GET", "/api/browse?q=");
    assert.equal(search.cards.find((c) => c.id === 1).reverse, true, "the sheet's switch starts on");
    assert.equal((await B("GET", "/api/browse?q=")).cards.find((c) => c.id === 1).reverse, false);
    await app.close();
  });

  it("two accounts each have their own reverse of one Kaishi word, and a star stays with its account", async () => {
    const { app, db, A, B, reverseOfOne } = await twoOnKaishi();
    await A("POST", "/api/cards/1/reverse", { on: true });
    await B("POST", "/api/cards/1/reverse", { on: true });
    const [ra, rb] = reverseOfOne();
    assert.notEqual(ra.owner_id, rb.owner_id);
    await A("POST", "/api/stars", { cardId: ra.id, starred: true, changedAt: Math.floor(Date.now() / 1000) });
    const starred = db.prepare("SELECT user_id, card_id FROM card_stars WHERE starred = 1").all();
    assert.ok(starred.every((s) => s.user_id === ra.owner_id), "B's reverse is not starred by A");
    assert.ok(!starred.some((s) => s.card_id === rb.id));
    await app.close();
  });

  it("the deck's switch sets every card of the deck, and says how many", async () => {
    const { app, db, A, reverseOfOne } = await twoOnKaishi();
    const on = await A("PATCH", "/api/decks/settings", { deckKey: "kaishi", reverse: true });
    assert.equal(on.settings.reverse, true);
    assert.equal(on.reversed, 3);
    const decks = await A("GET", "/api/decks");
    assert.equal(decks.decks.find((d) => d.key === "kaishi").cards, 6, "three words, both ways, as Noji counts");

    // One card set apart, then the deck switched again: the deck's switch wins, as Select all does.
    await A("POST", "/api/cards/1/reverse", { on: false });
    assert.equal(reverseOfOne().length, 0);
    const off = await A("PATCH", "/api/decks/settings", { deckKey: "kaishi", reverse: false });
    assert.equal(off.reversed, 2);
    assert.equal(db.prepare("SELECT count(*) n FROM cards WHERE reverse_of IS NOT NULL AND deleted_at IS NULL").get().n, 0);
    await app.close();
  });

  it("a card added to a deck whose switch is on starts both ways", async () => {
    const { app, db, A } = await twoOnKaishi();
    const { card } = await A("POST", "/api/cards", { word: "Neko", meaning: "Katze" });
    await A("PATCH", "/api/decks/settings", { deckKey: `deck:${card.deck_id}`, reverse: true });
    const { card: next } = await A("POST", "/api/cards", { word: "Inu", meaning: "Hund", deckId: card.deck_id });
    assert.equal(next.reverse, true);
    const { card: apart } = await A("POST", "/api/cards", { word: "Tori", meaning: "Vogel", deckId: card.deck_id, reverse: false });
    assert.equal(apart.reverse, false, "unless she switched it off in the form");
    assert.equal(db.prepare("SELECT count(*) n FROM cards WHERE reverse_of IS NOT NULL AND deleted_at IS NULL").get().n, 2);
    await app.close();
  });

  it("a reverse that waits for another day leaves its new-card place to another word", async () => {
    const { app, A } = await twoOnKaishi();
    // Kaishi's 3 words both ways; word 1 answered two days ago with Gut, so it
    // is due today and its reverse would be new today.
    await A("PATCH", "/api/decks/settings", { deckKey: "kaishi", reverse: true, newPerDay: 5 });
    const now = Math.floor(Date.now() / 1000);
    await A("POST", "/api/events", { events: [{ id: uid(60), card_id: 1, mode: "flip", rating: 3, reviewed_at: now - 2 * DAY }] });
    const flip = await A("GET", "/api/queue?deckKey=kaishi&mode=flip");
    // Word 1 due, words 2 and 3 new; 1's reverse waits. Nothing else is eligible.
    assert.deepEqual([...flip.cardIds].sort((a, b) => a - b), [1, 2, 3]);
    await app.close();
  });

  it("a deck's daily maximum does not put a word and its reverse back together", async () => {
    const { app, db, A, reverseOfOne } = await twoOnKaishi();
    await A("POST", "/api/cards/1/reverse", { on: true });
    const rev = reverseOfOne()[0];
    const now = Math.floor(Date.now() / 1000);
    // Both directions answered two days ago with Gut: both due today.
    await A("POST", "/api/events", {
      events: [
        { id: uid(70), card_id: 1, mode: "flip", rating: 3, reviewed_at: now - 2 * DAY },
        { id: uid(71), card_id: rev.id, mode: "flip", rating: 3, reviewed_at: now - 2 * DAY },
      ],
    });
    await A("PATCH", "/api/decks/settings", { deckKey: "kaishi", maxPerDay: 20 });
    for (const only of ["", "&only=ahead"]) {
      const ids = (await A("GET", `/api/queue?deckKey=kaishi&mode=flip${only}`)).cardIds;
      assert.ok(ids.includes(1), only);
      assert.ok(!ids.includes(rev.id), `the reverse waits${only}`);
    }
    await app.close();
  });

  it("a kana has no other way round, and a reverse is switched by its original", async () => {
    const { app, db, A, reverseOfOne } = await twoOnKaishi();
    db.prepare("INSERT INTO cards (id, word, word_meaning, deck) VALUES (10000001, 'か', 'ka', 'hiragana')").run();
    const call = (id) => A("POST", `/api/cards/${id}/reverse`, { on: true });
    assert.equal((await call(10000001)).error, "not_found");
    await call(1);
    assert.equal((await call(reverseOfOne()[0].id)).error, "not_found");
    const kana = await A("PATCH", "/api/decks/settings", { deckKey: "hiragana", reverse: true });
    assert.equal(kana.settings.reverse, false);
    assert.equal(kana.reversed, 0);
    await app.close();
  });
});
