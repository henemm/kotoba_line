import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

/**
 * #183, migration 025: a generated recording goes out with its card only
 * while it is still a recording of that card's word — an edit silences it
 * at once, whatever path wrote the new word.
 */
describe("GET /api/deck carries a word's generated audio (#183)", () => {
  it("hands out the file and its checked flag, and neither once the word has changed", async () => {
    const { app, db, config } = await testApp();
    await seedUser(db);
    seedCards(db, 1);
    const cookie = await signIn(app, config);

    db.prepare(
      `UPDATE cards SET word_audio = NULL, word_audio_generated = 'word-generated-1-x.mp3',
         word_audio_generated_for = word, word_audio_checked = 0, updated_at = 10 WHERE id = 1`,
    ).run();
    let res = await app.inject({ method: "GET", url: "/api/deck?since=0", headers: { cookie } });
    let card = res.json().cards.find((c) => c.id === 1);
    assert.equal(card.word_audio_generated, "word-generated-1-x.mp3");
    assert.equal(card.word_audio_checked, 0);

    db.prepare("UPDATE cards SET word = word || 'x', updated_at = 20 WHERE id = 1").run();
    res = await app.inject({ method: "GET", url: "/api/deck?since=0", headers: { cookie } });
    card = res.json().cards.find((c) => c.id === 1);
    assert.equal(card.word_audio_generated, null);
    assert.equal(card.word_audio_checked, null);
    await app.close();
  });
});
