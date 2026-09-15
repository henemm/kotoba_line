import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_OFFERS, kaishiMatches, kaishiOf } from "../src/kaishi-match.js";

/**
 * v70 — while she types a card, the Kaishi words that are exactly what she
 * typed are offered for their recording. Counted on her Noji lists
 * (2026-09-15, scratchpad `count-kaishi-match.mjs`): of 551 words, 239 have one
 * exact match and 22 several, and all 212 the import linked are the only
 * match for what she had typed.
 */

const k = (id, word, reading, meaning, rank, audio = `${id}.mp3`) => ({ id, deck: "kaishi", word, word_reading: reading, word_meaning: meaning, frequency_rank: rank, word_audio: audio });
const kiku = k(1, "聞く", "きく", "to hear", 50);
const kikuAsk = k(2, "聞く", "きく", "to ask", 60);
const kiku3 = k(3, "効く", "きく", "to be effective", 900);
const kikoeru = k(4, "聞こえる", "きこえる", "to be heard", 300);
const ookii = k(5, "大きい", "おおきい", "big, large", 100);
const nani = k(6, "何", "なに・なん", "what", 10);
const hers = { id: -1, deck: "personal", word: "Kiku", word_reading: null, word_meaning: "Hören", word_audio: null };
const cards = [kiku3, kikoeru, kikuAsk, kiku, ookii, nani, hers];

describe("offering Kaishi's recording for a word she types (v70)", () => {
  it("offers every Kaishi word that is exactly what she typed, most common first", () => {
    assert.deepEqual(kaishiMatches("Kiku", cards).map((c) => c.id), [1, 2, 3]);
    assert.ok(!kaishiMatches("kiku", cards).includes(kikoeru), "a longer word is not this word");
    assert.deepEqual(kaishiMatches("ki", cards), [], "nothing while the word is half typed");
  });

  it("matches the way she writes it: long vowels either way, kana, either reading", () => {
    for (const typed of ["ookii", "okii", "Ōkii", "おおきい", "大きい"]) {
      assert.deepEqual(kaishiMatches(typed, cards).map((c) => c.id), [5], typed);
    }
    assert.deepEqual(kaishiMatches("nan", cards).map((c) => c.id), [6]);
    assert.deepEqual(kaishiMatches("なん", cards).map((c) => c.id), [6]);
  });

  it("offers only Kaishi's words, and a sentence nothing", () => {
    assert.ok(kaishiMatches("Kiku", cards).every((c) => c.deck === "kaishi"));
    assert.deepEqual(kaishiMatches("Issho ni tabemasen ka?", cards), []);
    assert.deepEqual(kaishiMatches("  ", cards), []);
  });

  it("keeps to a handful", () => {
    const many = Array.from({ length: 9 }, (_, i) => k(100 + i, "箸", "はし", `sense ${i}`, i));
    assert.equal(kaishiMatches("hashi", many).length, MAX_OFFERS);
  });

  it("finds the Kaishi word a card took its recording from", () => {
    assert.equal(kaishiOf({ word: "大きい", word_audio: "5.mp3" }, cards), ookii);
    assert.equal(kaishiOf({ word: "Kiku", word_audio: null }, cards), undefined);
  });
});
