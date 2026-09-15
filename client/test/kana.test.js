import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickDistractors } from "../src/deck.js";
import { isKana, showsScript, shownWord } from "../src/script.js";
import { flipsMeaningFirst, kanaExamples, meaningPool, strokeFiles } from "../src/screens/session.js";

// Pure logic only: what the kana card's back looks like was checked in WebKit.
const kana = (word, reading, deck = "hiragana", rank = 1) => ({
  id: 10_000_000 + rank + (deck === "katakana" ? 500 : 0),
  word,
  word_reading: word,
  word_meaning: reading,
  frequency_rank: rank,
  deck,
});
const kaishi = (id, word, furigana, meaning, rank) => ({
  id,
  word,
  word_furigana: furigana,
  word_meaning: meaning,
  frequency_rank: rank,
  deck: "kaishi",
});

describe("kana cards (#158)", () => {
  const ka = kana("か", "ka", "hiragana", 6);
  const ki = kana("き", "ki", "hiragana", 7);
  const ku = kana("く", "ku", "hiragana", 8);
  const zu = kana("ず", "zu", "hiragana", 53);
  const dzu = kana("づ", "zu", "hiragana", 58);
  const katakanaKa = kana("カ", "ka", "katakana", 6);
  const kasa = kaishi(1, "傘", "傘[かさ]", "umbrella", 900);
  const kyou = kaishi(2, "今日", "今日[きょう]", "today", 50);
  const kiku = kaishi(3, "聞く", "聞[き]く", "to hear", 300);
  const akai = kaishi(4, "赤い", "赤[あか]い", "red", 400);
  const coffee = kaishi(5, "コーヒー", null, "coffee", 700);
  const camera = kaishi(6, "カメラ", null, "camera", 800);
  const kaban = kaishi(7, "鞄", "鞄[かばん]", "bag", 100);

  it("shows its kana with the script switched off: in romaji it would show its own answer", () => {
    assert.equal(isKana(ka), true);
    assert.equal(isKana(kasa), false);
    assert.equal(shownWord(ka, false), "か");
    assert.equal(showsScript(ka, false), true);
    assert.equal(shownWord(kasa, false), "kasa", "a Kaishi word still turns to romaji");
  });

  it("asks めくる kana first", () => {
    assert.equal(flipsMeaningFirst(ka), false);
  });

  it("takes wrong answers only from kana of the same script", () => {
    const pool = [ka, ki, ku, katakanaKa, kasa, kyou];
    assert.deepEqual(meaningPool(ka, pool, true).map((c) => c.word), ["き", "く"]);
    assert.ok(!meaningPool(kasa, pool, true).some(isKana), "and never lends a Kaishi word a kana's reading");
  });

  it("takes wrong answers from the rows around the kana, not from ones not met yet", () => {
    const row = ["あ", "い", "う", "え", "お"].map((w, i) => kana(w, "aiueo"[i], "hiragana", i + 1));
    const ji = kana("じ", "ji", "hiragana", 52);
    assert.deepEqual(
      meaningPool(row[1], [...row, ka, ji], true).map((c) => c.word),
      ["あ", "う", "え", "お", "か"],
    );
    // Fewer than three near it: the whole script, rather than too few answers.
    assert.equal(meaningPool(ji, [ji, ...row], true).length, 5);
  });

  it("never offers two wrong answers that read the same (ず and づ are both zu)", () => {
    const pool = [zu, dzu, ka, ki, ku];
    for (let i = 0; i < 50; i++) {
      const offered = pickDistractors(ki, pool, 3).map((c) => c.word_meaning);
      assert.equal(new Set(offered).size, offered.length, offered.join(","));
    }
  });

  it("reads the example words the import stored on the card, and survives a bad value", () => {
    const withExamples = { ...ka, word_examples: JSON.stringify([{ kana: "かさ", meaning: "umbrella", source: "kaishi" }]) };
    assert.deepEqual(kanaExamples(withExamples), [{ kana: "かさ", meaning: "umbrella", source: "kaishi" }]);
    assert.deepEqual(kanaExamples(ka), []);
    assert.deepEqual(kanaExamples({ ...ka, word_examples: "{not json" }), []);
    assert.deepEqual(kanaExamples({ ...ka, word_examples: JSON.stringify([{ kana: "か" }]) }), [], "an entry without a meaning is left out");
  });

  it("names the stroke-order drawings the way the import writes them", () => {
    assert.deepEqual(strokeFiles(ka), ["kanjivg-0304b.svg"]);
    assert.deepEqual(strokeFiles(kana("きゃ", "kya")), ["kanjivg-0304d.svg", "kanjivg-03083.svg"]);
  });
});
