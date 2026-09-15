import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDatabase } from "../../server/src/db.js";
import { kanaExamples, writeKanaCards } from "../import-kana.js";
import { makeMeaningLookup, parseJlptCsv, pickExamples, shortGloss, soundAt, startsWithSound } from "../lib/examples.js";
import { kanaId } from "../lib/kana.js";

// A few entries shaped like jmdict-simplified's JSON.
const word = (kana, glosses, { kanji = [], common = true, senses } = {}) => ({
  kanji: kanji.map((text) => ({ text, common })),
  kana: [{ text: kana, common }],
  sense: senses ?? [{ gloss: glosses.map((text) => ({ text })) }],
});
const jmdict = [
  word("カメラ", ["camera"]),
  word("パン", ["bread", "(sweet) pastry"]),
  word("パン", ["pan (camera)"], { common: false }),
  word("はし", ["bridge"], { kanji: ["橋"] }),
  word("はし", ["chopsticks"], { kanji: ["箸"] }),
  word("ジュース", ["juice"], { senses: [{ gloss: [{ text: "juice" }] }, { gloss: [{ text: "deuce" }] }] }),
];

describe("example words for the kana decks (#158, v78)", () => {
  it("counts a kana only where it starts the word as its own sound", () => {
    assert.equal(startsWithSound("かさ", "か"), true);
    assert.equal(startsWithSound("あか", "か"), false, "inside a word");
    assert.equal(startsWithSound("きょう", "き"), false, "き before ょ is きょ");
    assert.equal(startsWithSound("きょう", "きょ"), true);
    assert.equal(startsWithSound("かばん", "ん"), true, "ん, which never starts a word, anywhere");
  });

  it("keeps a meaning to one short line", () => {
    assert.equal(shortGloss("cup (drinking vessel, measure, brassiere, prize, etc.)"), "cup");
    assert.equal(shortGloss("restaurant (esp. Western-style)"), "restaurant");
    assert.equal(shortGloss("elephant (Elephantidae spp.)"), "elephant");
    assert.equal(shortGloss("(swimming) pool"), "(swimming) pool");
    assert.equal(shortGloss("match (for lighting a fire)"), "match (for lighting a fire)");
  });

  it("leaves out a word whose first sense would mislead", () => {
    const meaningOf = makeMeaningLookup([word("チェック", ["check (pattern)", "plaid"])]);
    assert.equal(meaningOf({ written: "チェック", reading: "チェック" }), undefined);
  });

  it("reads the JLPT CSV", () => {
    assert.deepEqual(parseJlptCsv("Kanji,Reading\n会う,あう\nカメラ,カメラ\n", 5), [
      { written: "会う", reading: "あう", level: 5 },
      { written: "カメラ", reading: "カメラ", level: 5 },
    ]);
  });

  it("takes the first sense of the common entry, and the kanji has to match", () => {
    const meaningOf = makeMeaningLookup(jmdict);
    assert.equal(meaningOf({ written: "パン", reading: "パン" }), "bread");
    assert.equal(meaningOf({ written: "ジュース", reading: "ジュース" }), "juice", "not the tennis deuce");
    assert.equal(meaningOf({ written: "橋", reading: "はし" }), "bridge");
    assert.equal(meaningOf({ written: "箸", reading: "はし" }), "chopsticks");
    assert.equal(meaningOf({ written: "ラジカセ", reading: "ラジカセ" }), undefined, "not in the dictionary: no guess");
  });

  it("takes Kaishi first, then the JLPT lists in level order, and never the same word twice", () => {
    const meaningOf = makeMeaningLookup(jmdict);
    const jlpt = [
      { written: "パン", reading: "パン", level: 5 },
      { written: "パン", reading: "パン", level: 4 },
      { written: "パーティー", reading: "パーティー", level: 5 },
    ];
    const pa = { word: "パ", deck: "katakana" };
    assert.deepEqual(pickExamples(pa, { jlpt, meaningOf }), [{ kana: "パン", meaning: "bread", source: "jlpt-n5", at: 0 }]);
    const kaishi = [{ reading: "パーティー", meaning: "party" }];
    assert.deepEqual(
      pickExamples(pa, { kaishi, jlpt, meaningOf }).map((e) => [e.kana, e.source]),
      [["パーティー", "kaishi"], ["パン", "jlpt-n5"]],
    );
  });

  it("finds the sound inside a word, but not where it is not heard as itself (v83)", () => {
    assert.equal(soundAt("かさ", "か"), 0);
    assert.equal(soundAt("あか", "か"), 1, "inside a word");
    assert.equal(soundAt("きょう", "き"), -1, "き before ょ is きょ");
    assert.equal(soundAt("りょこう", "こ"), 2);
    assert.equal(soundAt("そう", "う"), -1, "long ō");
    assert.equal(soundAt("きょう", "う"), -1, "long ō after a yōon");
    assert.equal(soundAt("くうき", "う"), -1, "long ū");
    assert.equal(soundAt("あう", "う"), 1, "after a, う is u");
    assert.equal(soundAt("おおきい", "お"), 0, "the first お starts the word");
    assert.equal(soundAt("とおい", "お"), -1, "long ō");
    assert.equal(soundAt("せんせい", "い"), -1, "long ē");
    assert.equal(soundAt("まあ", "あ"), -1, "long ā");
    assert.equal(soundAt("おおきい", "い"), -1, "long ī");
    assert.equal(soundAt("おねえさん", "え"), -1, "long ē after e");
    assert.equal(soundAt("ばあい", "い"), 2, "after a, い is i");
    assert.equal(soundAt("かいしゃ", "い"), 1);
    assert.equal(soundAt("です", "す"), -1, "whispered at the end");
    assert.equal(soundAt("すし", "す"), 0);
    assert.equal(soundAt("じつは", "は"), -1, "the particle, said wa");
    assert.equal(soundAt("はなし", "は"), 0);
    assert.equal(soundAt("いう", "う"), -1, "said ゆう");
    assert.equal(soundAt("いう", "い"), 0);
    assert.equal(soundAt("でんしゃ", "しゃ"), 2, "a yōon inside a word");
    assert.equal(soundAt("コーヒー", "ヒ"), 2, "katakana too");
    assert.equal(soundAt("はな", "ハ"), -1, "a katakana card is never given a hiragana word");
    assert.equal(soundAt("ハンカチ", "は"), -1, "nor a hiragana card a katakana one");
    assert.equal(soundAt("ボウル", "ウ"), -1, "long ō in katakana too");
  });

  it("puts recorded words first: one that starts with the kana, then two with it inside (v83)", () => {
    const meaningOf = makeMeaningLookup(jmdict);
    const kaishi = [
      { reading: "かさ", meaning: "umbrella" },
      { reading: "かばん", meaning: "bag", audio: "kaban.mp3" },
      { reading: "あか", meaning: "red", audio: "aka.mp3" },
      { reading: "かみ", meaning: "paper", audio: "kami.mp3" },
      { reading: "さかな", meaning: "fish", audio: "sakana.mp3" },
      { reading: "たかい", meaning: "tall", audio: "takai.mp3" },
    ];
    assert.deepEqual(
      pickExamples({ word: "か", deck: "hiragana" }, { kaishi, meaningOf }).map((e) => [e.kana, e.audio, e.at]),
      [["かばん", "kaban.mp3", 0], ["あか", "aka.mp3", 1], ["さかな", "sakana.mp3", 1]],
    );
    // Without a recording a word still has to start with the kana.
    const silent = [{ reading: "あか", meaning: "red" }, { reading: "かさ", meaning: "umbrella" }, { reading: "か・が", meaning: "two readings", audio: "x.mp3" }];
    assert.deepEqual(pickExamples({ word: "か", deck: "hiragana" }, { kaishi: silent, meaningOf }).map((e) => e.kana), ["かさ"]);
  });

  it("never gives a hiragana card a katakana word", () => {
    const meaningOf = makeMeaningLookup(jmdict);
    const jlpt = [{ written: "カメラ", reading: "カメラ", level: 5 }];
    assert.deepEqual(pickExamples({ word: "か", deck: "hiragana" }, { jlpt, meaningOf }), []);
    assert.equal(pickExamples({ word: "カ", deck: "katakana" }, { jlpt, meaningOf }).length, 1);
  });

  it("stores them on the cards, and a second run with the same sources changes nothing", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO cards (id, word, word_furigana, word_meaning, frequency_rank, deck, updated_at) VALUES (1, '傘', '傘[かさ]', 'umbrella', 900, 'kaishi', 1)").run();
    const sources = { jlpt: [{ written: "カメラ", reading: "カメラ", level: 5 }], jmdictWords: jmdict };
    assert.equal(writeKanaCards(db, 1000, kanaExamples(db, sources)), 208);
    const stored = (kana) => db.prepare("SELECT word_examples FROM cards WHERE id = ?").get(kanaId(kana)).word_examples;
    assert.deepEqual(JSON.parse(stored("か")), [{ kana: "かさ", meaning: "umbrella", source: "kaishi", at: 0 }]);
    assert.deepEqual(JSON.parse(stored("カ")), [{ kana: "カメラ", meaning: "camera", source: "jlpt-n5", at: 0 }]);
    assert.equal(stored("ぬ"), null, "no word, no examples");
    assert.equal(writeKanaCards(db, 2000, kanaExamples(db, sources)), 0);
    assert.equal(writeKanaCards(db, 3000), 0, "without sources the stored examples are kept");
    assert.ok(stored("カ"));
    db.close();
  });
});
