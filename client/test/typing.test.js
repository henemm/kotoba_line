import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { judge, kanaPreview, normalizeTyped, spells, splitReadings } from "../src/typing.js";

const card = (word, reading, id = 1) => ({ id, word, readings: splitReadings(reading) });
const right = (typed, word, reading) => Boolean(judge(typed, [card(word, reading)]));

/**
 * The whole deck was also run through `judge` with each reading's own
 * `toRomaji` spelling on 2026-09-13: 1,501 of 1,501 readings accepted, and
 * no reading accepted with its last letter missing except 何's `nan`, which is
 * the other reading. These are the cases that measurement does not reach —
 * the spellings a keyboard produces that the romaji line never shows.
 */
describe("書く: what counts as the right Japanese (#97)", () => {
  it("takes the romaji the app itself shows", () => {
    assert.ok(right("taberu", "食べる", "たべる"));
    assert.ok(right("toukyou", "東京", "とうきょう"));
    assert.ok(right("kin'youbi", "金曜日", "きんようび"));
    assert.ok(right("koohii", "コーヒー", "コーヒー"));
    assert.ok(right("konnyaku", "こんにゃく", "こんにゃく"));
  });

  it("takes what a keyboard would have her type instead", () => {
    assert.ok(right("kinnyoubi", "金曜日", "きんようび"), "nn for ん");
    assert.ok(right("konnnichiha", "こんにちは", "こんにちは"), "nn then ni");
    assert.ok(right("ko-hi-", "コーヒー", "コーヒー"), "- for ー");
    assert.ok(right("tuduku", "続く", "つづく"), "tu and du");
    assert.ok(right("tsuzuku", "続く", "つづく"), "zu for づ, as it sounds");
    assert.ok(right("sinbun", "新聞", "しんぶん"), "si for し");
    assert.ok(right("mattya", "抹茶", "まっちゃ"));
    assert.ok(right("maccha", "抹茶", "まっちゃ"));
    assert.ok(right("matcha", "抹茶", "まっちゃ"));
  });

  it("takes kana from the Japanese keyboard, and the word itself", () => {
    assert.ok(right("たべる", "食べる", "たべる"));
    assert.ok(right("タベル", "食べる", "たべる"), "katakana is the same reading");
    assert.ok(right("こーひー", "コーヒー", "コーヒー"));
    assert.ok(right("食べる", "食べる", "たべる"));
    assert.ok(right("たbeる", "食べる", "たべる"), "a keyboard switched halfway");
  });

  it("ignores what iOS does to a word she typed", () => {
    assert.ok(right("Taberu", "食べる", "たべる"), "the capital from auto-capitalise");
    assert.ok(right(" taberu ", "食べる", "たべる"));
    assert.ok(right("kin’youbi", "金曜日", "きんようび"), "smart punctuation's apostrophe");
    assert.ok(right("ko—hi—", "コーヒー", "コーヒー"), "smart punctuation's dash");
    assert.ok(right("ｔａｂｅｒｕ", "食べる", "たべる"), "full-width letters");
    assert.ok(right("taberu.", "食べる", "たべる"));
  });

  it("accepts either reading of a word that has two", () => {
    assert.ok(right("nani", "何", "なに・なん"));
    assert.ok(right("nan", "何", "なに・なん"));
  });

  it("does not forgive a different word, or half of one", () => {
    assert.ok(!right("tokyo", "東京", "とうきょう"), "a long vowel is spelling, not accent");
    assert.ok(!right("kinyoubi", "金曜日", "きんようび"), "that is きにょうび");
    assert.ok(!right("tabe", "食べる", "たべる"));
    assert.ok(!right("taberuu", "食べる", "たべる"));
    assert.ok(!right("", "食べる", "たべる"));
    assert.ok(!right("   ", "食べる", "たべる"));
    assert.ok(!right("食", "食べる", "たべる"));
  });

  it("says which card she typed when two share a meaning", () => {
    // "big, large" is 大きい and 大きな in the deck; the prompt cannot say which.
    const answers = [card("大きい", "おおきい", 10), card("大きな", "おおきな", 11)];
    assert.equal(judge("ookina", answers)?.id, 11);
    assert.equal(judge("ookii", answers)?.id, 10);
    assert.equal(judge("chiisai", answers), undefined);
  });

  it("does not treat a plain n before a vowel as ん", () => {
    assert.equal(spells("kanoo", "かんおう"), false);
    assert.equal(spells("kan'ou", "かんおう"), true);
  });
});

describe("書く: the kana under the field", () => {
  it("turns romaji into the kana a keyboard would show", () => {
    assert.equal(kanaPreview("taberu"), "たべる");
    assert.equal(kanaPreview("konnichiha"), "こんにちは");
    assert.equal(kanaPreview("matcha"), "まっちゃ");
    assert.equal(kanaPreview("kitte"), "きって");
    assert.equal(kanaPreview("ko-hi-"), "こーひー");
    assert.equal(kanaPreview("ti"), "ち", "a keyboard's ti, not the romaji line's てぃ");
    assert.equal(kanaPreview("wo"), "を");
  });

  it("leaves letters that are not a sound yet as letters", () => {
    assert.equal(kanaPreview("taber"), "たべr");
  });

  it("shows a last n as ん, and a doubled one as one ん", () => {
    assert.equal(kanaPreview("san"), "さん");
    assert.equal(kanaPreview("honn"), "ほん");
    assert.equal(kanaPreview("kin'youbi"), "きんようび");
  });

  it("passes kana and kanji through untouched", () => {
    assert.equal(kanaPreview("食べる"), "食べる");
    assert.equal(kanaPreview("タベル"), "たべる");
  });

  it("normalises the same way judging does", () => {
    assert.equal(normalizeTyped("Kin’youbi "), "kin'youbi");
  });
});
