import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCard } from "../src/cards.js";
import { offerKaishiTopics } from "../src/kaishi-topics.js";
import { seedUser, testApp } from "./helpers.js";

/**
 * Her own cards take the topics of the Kaishi word they are (#209). Made-up
 * cards in the shapes the real ones have: romaji typed by her, a card that
 * took a Kaishi recording, kana, and a word with two Kaishi senses.
 */

function kaishi(db, id, word, reading, tags, audio = null) {
  db.prepare(
    `INSERT INTO cards (id, word, word_reading, word_meaning, word_audio, deck, updated_at)
     VALUES (?, ?, ?, 'x', ?, 'kaishi', 1)`,
  ).run(id, word, reading, audio);
  for (const t of tags) db.prepare("INSERT INTO tags (card_id, tag) VALUES (?, ?)").run(id, t);
}

function mine(db, userId, id, word, { audio = null, tags = [] } = {}) {
  db.prepare(
    `INSERT INTO cards (id, word, word_meaning, word_audio, deck, owner_id, updated_at)
     VALUES (?, ?, 'Deutsch', ?, 'personal', ?, 1)`,
  ).run(id, word, audio, userId);
  for (const t of tags) db.prepare("INSERT INTO tags (card_id, tag) VALUES (?, ?)").run(id, t);
}

const topicsOf = (db, id) =>
  db.prepare("SELECT tag FROM tags WHERE card_id = ? ORDER BY tag").all(id).map((r) => r.tag);

async function setUp() {
  const { db } = await testApp();
  const user = await seedUser(db);
  kaishi(db, 1, "電車", "でんしゃ", ["train", "movement"]);
  kaishi(db, 2, "聞く", "きく", ["senses", "speaking"]);
  kaishi(db, 3, "聞く", "きく", ["speaking"]);
  kaishi(db, 4, "食べる", "たべる", ["food", "actions"], "taberu.mp3");
  kaishi(db, 5, "猫", "ねこ", ["nature"]);
  return { db, user };
}

describe("her cards take Kaishi's topics (#209)", () => {
  it("matches romaji she typed, a recording she took, and kana", async () => {
    const { db, user } = await setUp();
    mine(db, user.id, -1, "Densha");
    mine(db, user.id, -2, "Essen", { audio: "taberu.mp3" });
    mine(db, user.id, -3, "ねこ");
    assert.equal(offerKaishiTopics(db, { now: 2_000_000_000_000 }), 3);
    assert.deepEqual(topicsOf(db, -1), ["movement", "train"]);
    assert.deepEqual(topicsOf(db, -2), ["actions", "food"]);
    assert.deepEqual(topicsOf(db, -3), ["nature"]);
    // The phone's copy is refreshed by updated_at.
    assert.equal(db.prepare("SELECT updated_at FROM cards WHERE id = -1").get().updated_at, 2_000_000_000);
  });

  it("gives a word with several senses only the topics they share", async () => {
    const { db, user } = await setUp();
    mine(db, user.id, -1, "Kiku");
    offerKaishiTopics(db);
    assert.deepEqual(topicsOf(db, -1), ["speaking"]);
  });

  it("gives nothing where no Kaishi word matches, and leaves updated_at alone", async () => {
    const { db, user } = await setUp();
    mine(db, user.id, -1, "Koko wa doko desu ka");
    assert.equal(offerKaishiTopics(db), 0);
    assert.deepEqual(topicsOf(db, -1), []);
    assert.equal(db.prepare("SELECT updated_at FROM cards WHERE id = -1").get().updated_at, 1);
  });

  it("adds to her own topics instead of replacing them", async () => {
    const { db, user } = await setUp();
    mine(db, user.id, -1, "Densha", { tags: ["schulweg"] });
    offerKaishiTopics(db);
    assert.deepEqual(topicsOf(db, -1), ["movement", "schulweg", "train"]);
  });

  it("offers a card once: a topic she took off stays off", async () => {
    const { db, user } = await setUp();
    mine(db, user.id, -1, "Densha");
    offerKaishiTopics(db);
    db.prepare("DELETE FROM tags WHERE card_id = -1 AND tag = 'movement'").run();
    assert.equal(offerKaishiTopics(db), 0);
    assert.deepEqual(topicsOf(db, -1), ["train"]);
  });

  it("offers a card she adds in the app as it is saved", async () => {
    const { db, user } = await setUp();
    const card = createCard(db, user.id, { word: "Densha", meaning: "Zug" }, 2_000_000_000_000);
    assert.deepEqual([...card.tags].sort(), ["movement", "train"]);
  });

  it("never touches a Kaishi card", async () => {
    const { db } = await setUp();
    offerKaishiTopics(db);
    assert.deepEqual(topicsOf(db, 3), ["speaking"]);
  });
});
