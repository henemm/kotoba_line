import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { deckSettings } from "../src/deck-settings.js";
import { seedUser, signIn, testApp } from "./helpers.js";

/**
 * Her own decks (#137, migration 016): made, renamed and deleted by her, with
 * cards added to one and moved between them. Made-up words only.
 */

const migrations = new URL("../migrations/", import.meta.url);

/** A database as it stood before migration 016: everything up to 015. */
function databaseBefore(name) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    if (file >= name) break;
    db.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  return db;
}

describe("migration 016: her lists become decks", () => {
  it("makes a deck of each list in the order the practise tab showed them, and carries its settings", async () => {
    const db = databaseBefore("016");
    const her = await seedUser(db);
    const friend = await seedUser(db, { handle: "ken", display: "Ken" });
    const card = db.prepare(
      `INSERT INTO cards (id, word, word_meaning, deck, owner_id, updated_at, deleted_at, list_name)
       VALUES (?, ?, ?, 'personal', ?, 1, ?, ?)`,
    );
    // Ids are negative epoch ms: the more negative, the earlier in her list order.
    card.run(-30, "Yomu", "Lesen", her.id, null, "1000");
    card.run(-50, "Taberu", "Essen", her.id, null, "100 vokabeln");
    card.run(-49, "Nomu", "Trinken", her.id, null, "100 vokabeln");
    card.run(-20, "Kaku", "Schreiben", her.id, null, null);
    card.run(-10, "Kiku", "Hören", her.id, 5, null);
    card.run(-40, "Miru", "Sehen", friend.id, null, "1000");
    const setting = db.prepare("INSERT INTO deck_settings (user_id, deck_key, hidden_modes, new_per_day, updated_at) VALUES (?, ?, ?, ?, 1)");
    setting.run(her.id, "list:100 vokabeln", '["speak","type"]', 15);
    setting.run(her.id, "kaishi", "[]", 25);
    setting.run(her.id, "list:gone", "[]", 30);

    db.exec(readFileSync(new URL("016_decks.sql", migrations), "utf8"));

    const decks = db.prepare("SELECT id, owner_id, name FROM decks ORDER BY id").all();
    assert.deepEqual(
      decks.map((d) => [d.owner_id, d.name]),
      [[her.id, "100 vokabeln"], [her.id, "1000"], [friend.id, "1000"], [her.id, "My words"]],
    );
    const idOf = (owner, name) => decks.find((d) => d.owner_id === owner && d.name === name).id;

    const cards = Object.fromEntries(db.prepare("SELECT id, deck_id, updated_at FROM cards").all().map((c) => [c.id, c]));
    assert.equal(cards[-50].deck_id, idOf(her.id, "100 vokabeln"));
    assert.equal(cards[-30].deck_id, idOf(her.id, "1000"));
    assert.equal(cards[-40].deck_id, idOf(friend.id, "1000"), "a friend's list is a deck of the friend's");
    assert.equal(cards[-20].deck_id, idOf(her.id, "My words"));
    assert.equal(cards[-10].deck_id, null, "a word deleted before decks is in none");
    assert.ok(cards[-50].updated_at > 1, "stamped, so her phone is sent the deck");

    assert.deepEqual(
      db.prepare("SELECT deck_key, hidden_modes, new_per_day FROM deck_settings WHERE user_id = ? ORDER BY deck_key").all(her.id),
      [
        { deck_key: `deck:${idOf(her.id, "100 vokabeln")}`, hidden_modes: '["speak","type"]', new_per_day: 15 },
        { deck_key: "kaishi", hidden_modes: "[]", new_per_day: 25 },
      ],
      "her settings follow the deck, and settings for a list that is gone are dropped",
    );
    // The code reads the schema as it is now, so the migrations after 016 run first.
    for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql") && f > "016_decks.sql").sort()) {
      db.exec(readFileSync(new URL(file, migrations), "utf8"));
    }
    const expected = { hiddenModes: ["speak", "type"], newPerDay: 15, maxPerDay: null, extraNew: 0, extraNewDay: null };
    assert.deepEqual(deckSettings(db, her.id, `deck:${idOf(her.id, "100 vokabeln")}`), expected);
    assert.deepEqual(deckSettings(db, her.id, "list:100 vokabeln"), expected, "and the old key reads the same row");
  });
});

async function signedIn() {
  const { app, db, config } = await testApp();
  const user = await seedUser(db);
  const cookie = await signIn(app, config);
  const call = async (method, url, payload) => {
    const res = await app.inject({ method, url, headers: { cookie }, payload });
    return { status: res.statusCode, body: res.json() };
  };
  return { app, db, user, call };
}

describe("her own decks (#137)", () => {
  it("makes a new, empty deck she can see, and refuses a name she already uses", async () => {
    const { app, call } = await signedIn();
    const made = await call("POST", "/api/decks", { name: "  Im  Zug " });
    assert.equal(made.status, 201);
    assert.equal(made.body.deck.name, "Im Zug");
    const { body } = await call("GET", "/api/decks");
    const deck = body.decks.find((d) => d.key === `deck:${made.body.deck.id}`);
    assert.deepEqual([deck.name, deck.own, deck.cards, deck.today.total], ["Im Zug", true, 0, 0]);
    assert.equal((await call("POST", "/api/decks", { name: "Im Zug" })).status, 409);
    assert.equal((await call("POST", "/api/decks", { name: "   " })).status, 400);
    await app.close();
  });

  it("adds a card to the deck she is in, and a card from an older phone to My words", async () => {
    const { app, db, call } = await signedIn();
    const { body: { deck } } = await call("POST", "/api/decks", { name: "Im Zug" });
    const added = await call("POST", "/api/cards", { word: "Eki wa doko desu ka", meaning: "Wo ist der Bahnhof", deckId: deck.id });
    assert.equal(added.status, 201);
    assert.equal(added.body.card.deck_id, deck.id);
    const old = await call("POST", "/api/cards", { word: "Kuruma", meaning: "Auto" });
    const myWords = db.prepare("SELECT id FROM decks WHERE name = 'My words'").get();
    assert.equal(old.body.card.deck_id, myWords.id);
    const { body } = await call("GET", "/api/decks");
    assert.deepEqual(body.decks.filter((d) => d.own).map((d) => [d.name, d.cards]), [["Im Zug", 1], ["My words", 1]]);
    await app.close();
  });

  it("moves a card to another deck, and leaves it where it is when no deck is sent", async () => {
    const { app, call } = await signedIn();
    const a = (await call("POST", "/api/decks", { name: "A" })).body.deck;
    const b = (await call("POST", "/api/decks", { name: "B" })).body.deck;
    const { card } = (await call("POST", "/api/cards", { word: "Densha", meaning: "Zug", deckId: a.id })).body;
    const moved = await call("PUT", `/api/cards/${card.id}`, { word: "Densha", meaning: "Zug", deckId: b.id });
    assert.equal(moved.body.card.deck_id, b.id);
    const edited = await call("PUT", `/api/cards/${card.id}`, { word: "Densha", meaning: "Der Zug" });
    assert.equal(edited.body.card.deck_id, b.id, "a phone from before decks edits without moving");
    await app.close();
  });

  it("keeps a deck's settings and cards through a rename", async () => {
    const { app, call } = await signedIn();
    const deck = (await call("POST", "/api/decks", { name: "1000" })).body.deck;
    await call("POST", "/api/cards", { word: "Yomu", meaning: "Lesen", deckId: deck.id });
    await call("PATCH", "/api/decks/settings", { deckKey: `deck:${deck.id}`, newPerDay: 5 });
    const renamed = await call("PATCH", `/api/decks/${deck.id}`, { name: "Tausend" });
    assert.equal(renamed.body.deck.name, "Tausend");
    const listed = (await call("GET", "/api/decks")).body.decks.find((d) => d.id === deck.id);
    assert.deepEqual([listed.name, listed.cards, listed.settings.newPerDay], ["Tausend", 1, 5]);
    await call("POST", "/api/decks", { name: "Other" });
    assert.equal((await call("PATCH", `/api/decks/${deck.id}`, { name: "Other" })).status, 409);
    await app.close();
  });

  it("deletes a deck with its cards, keeps her history, and frees the name", async () => {
    const { app, db, user, call } = await signedIn();
    const deck = (await call("POST", "/api/decks", { name: "Weg" })).body.deck;
    const { card } = (await call("POST", "/api/cards", { word: "Yomu", meaning: "Lesen", deckId: deck.id })).body;
    db.prepare("INSERT INTO review_events (id, user_id, card_id, rating, mode, reviewed_at, received_at) VALUES ('e1', ?, ?, 3, 'flip', 1, 1)").run(user.id, card.id);
    db.prepare("INSERT INTO card_state (card_id, user_id, due_at, reps, last_review) VALUES (?, ?, 1, 1, 1)").run(card.id, user.id);
    await call("PATCH", "/api/decks/settings", { deckKey: `deck:${deck.id}`, newPerDay: 5 });

    const res = await call("DELETE", `/api/decks/${deck.id}`);
    assert.deepEqual(res.body, { ok: true, cards: 1 });
    assert.ok(db.prepare("SELECT deleted_at FROM cards WHERE id = ?").get(card.id).deleted_at);
    assert.equal(db.prepare("SELECT count(*) n FROM card_state WHERE card_id = ?").get(card.id).n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM review_events WHERE card_id = ?").get(card.id).n, 1, "her history stays");
    assert.equal(db.prepare("SELECT count(*) n FROM deck_settings WHERE deck_key = ?").get(`deck:${deck.id}`).n, 0);
    assert.ok(!(await call("GET", "/api/decks")).body.decks.some((d) => d.id === deck.id));
    assert.equal((await call("POST", "/api/decks", { name: "Weg" })).status, 201);
    assert.equal((await call("DELETE", `/api/decks/${deck.id}`)).status, 404);
    await app.close();
  });

  it("never lets her touch someone else's deck", async () => {
    const { app, db, call } = await signedIn();
    const ken = await seedUser(db, { handle: "ken", display: "Ken" });
    const { lastInsertRowid } = db.prepare("INSERT INTO decks (owner_id, name, created_at, updated_at) VALUES (?, 'Kens', 1, 1)").run(ken.id);
    const id = Number(lastInsertRowid);
    assert.equal((await call("PATCH", `/api/decks/${id}`, { name: "Mine" })).status, 404);
    assert.equal((await call("DELETE", `/api/decks/${id}`)).status, 404);
    assert.equal((await call("POST", "/api/cards", { word: "Yomu", meaning: "Lesen", deckId: id })).status, 404);
    assert.equal((await call("PATCH", "/api/decks/settings", { deckKey: `deck:${id}`, newPerDay: 5 })).status, 404);
    assert.ok(!(await call("GET", "/api/decks")).body.decks.some((d) => d.id === id));
    await app.close();
  });

  it("sends each card's deck to the device", async () => {
    const { app, call } = await signedIn();
    const deck = (await call("POST", "/api/decks", { name: "A" })).body.deck;
    await call("POST", "/api/cards", { word: "Yomu", meaning: "Lesen", deckId: deck.id });
    const { body } = await call("GET", "/api/deck?since=0");
    assert.equal(body.cards.find((c) => c.word === "Yomu").deck_id, deck.id);
    await app.close();
  });
});
