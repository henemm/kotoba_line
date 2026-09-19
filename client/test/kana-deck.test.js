import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { basicCells, kanaGroup, kanaOfDeck } from "../src/screens/kana-deck.js";

// Pure logic only: how the grid looks and what a tap opens was checked in WebKit.
const card = (word, word_meaning, frequency_rank, deck = "hiragana") => ({
  id: 10_000_000 + frequency_rank,
  word,
  word_meaning,
  frequency_rank,
  deck,
});

describe("a kana deck's letters (#208)", () => {
  it("keeps one deck, drops deleted cards, and orders by the teaching order, not the id", () => {
    const cards = [
      { ...card("きゃ", "kya", 72), id: 10_077_131 },
      { ...card("あ", "a", 1), id: 10_066_000 },
      { ...card("ア", "a", 1, "katakana"), id: 10_162_000 },
      { ...card("い", "i", 2), deleted_at: 5 },
      { id: 1, word: "猫", deck: "kaishi", frequency_rank: 1 },
    ];
    assert.deepEqual(kanaOfDeck("hiragana", cards).map((c) => c.word), ["あ", "きゃ"]);
    assert.deepEqual(kanaOfDeck("katakana", cards).map((c) => c.word), ["ア"]);
  });

  it("groups by the characters themselves", () => {
    assert.equal(kanaGroup({ word: "か" }), "basic");
    assert.equal(kanaGroup({ word: "が" }), "dakuten");
    assert.equal(kanaGroup({ word: "ぱ" }), "dakuten");
    assert.equal(kanaGroup({ word: "パ" }), "dakuten");
    assert.equal(kanaGroup({ word: "きゃ" }), "yoon");
    assert.equal(kanaGroup({ word: "ん" }), "basic");
  });

  it("lays the basic kana out as the gojūon table, gaps and all", () => {
    const rows = [
      ["ま", "ma"], ["み", "mi"], ["む", "mu"], ["め", "me"], ["も", "mo"],
      ["や", "ya"], ["ゆ", "yu"], ["よ", "yo"],
      ["ら", "ra"], ["り", "ri"], ["る", "ru"], ["れ", "re"], ["ろ", "ro"],
      ["わ", "wa"], ["を", "wo"], ["ん", "n"],
    ].map(([w, r], i) => card(w, r, i + 1));
    const table = basicCells(rows).map((c) => c?.word ?? "_");
    assert.deepEqual(table, [
      "ま", "み", "む", "め", "も",
      "や", "_", "ゆ", "_", "よ",
      "ら", "り", "る", "れ", "ろ",
      "わ", "_", "_", "_", "を",
      "ん",
    ]);
  });
});
