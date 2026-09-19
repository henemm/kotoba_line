import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seedUser, signIn, testApp } from "./helpers.js";

/** A card's sentence comes with its romaji (migration 028), matched by the sentence itself. */
describe("the deck sends each sentence's romaji", () => {
  it("gives the romaji of the card's current sentence, and none for a sentence without", async () => {
    const { app, db, config } = await testApp();
    await seedUser(db);
    const insert = db.prepare(
      "INSERT INTO cards (id, word, word_meaning, sentence, frequency_rank, updated_at) VALUES (?, ?, 'x', ?, ?, 1)",
    );
    insert.run(1, "靴", "この<b>靴</b>はいくらですか。", 1);
    insert.run(2, "駅", "駅はどこですか。", 2);
    db.prepare("INSERT INTO sentence_romaji (sentence, romaji) VALUES (?, ?)").run(
      "この<b>靴</b>はいくらですか。",
      "kono kutsu wa ikura desu ka.",
    );
    const cookie = await signIn(app, config);
    const { cards } = (await app.inject({ method: "GET", url: "/api/deck?since=0", headers: { cookie } })).json();
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    assert.equal(byId[1].sentence_romaji, "kono kutsu wa ikura desu ka.");
    assert.equal(byId[2].sentence_romaji, null);
  });
});
