import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideAccent,
  dictionaryForm,
  parseKanjium,
  parseOverrides,
  parseWadoku,
  planCard,
  resolveText,
  sameSound,
  tokenize,
  wordSoundName,
} from "../lib/word-sounds.js";

// Real Wadoku line shapes, including the one the first parser lost: text
// between "]" and the first "/" (まずい).
const WADOKU = parseWadoku(
  [
    "犬 [いぬ] /Hund/",
    "戌 [いぬ] /Hund (Tierkreiszeichen)/",
    "まずい;拙い;不味い [まずい] 不味い/nicht schmeckend/schlecht schmeckend/",
    "歯 [は] /Zahn/",
    "何時 [いつ] /wann/",
    "良い;いい [いい] /gut/",
    "タクシー [たくしー] /Taxi/",
    "トイレ [といれ] /Toilette/",
  ].join("\n"),
);
const KANJIUM = parseKanjium(["犬\tいぬ\t2", "歯\tは\t1", "タクシー\tたくしー\t1"].join("\n"));

describe("word-sounds (#183)", () => {
  it("parses Wadoku lines with text before the glosses", () => {
    assert.deepEqual(WADOKU.get("まずい")[0].words, ["まずい", "拙い", "不味い"]);
    assert.ok(WADOKU.get("まずい")[0].glosses.includes("nicht schmeckend"));
  });

  it("picks the Kaishi spelling over another entry with the same reading and German (犬, not 戌)", () => {
    assert.equal(dictionaryForm("inu", "Hund", WADOKU, new Set(["犬"])).written, "犬");
    // Without the common set: Wadoku's first matching entry, never "the first kanji found".
    assert.equal(dictionaryForm("inu", "Hund", WADOKU).written, "犬");
  });

  it("finds a loanword written with a doubled vowel under Wadoku's ー", () => {
    assert.deepEqual(dictionaryForm("takushii", "Taxi", WADOKU), { kana: "たくしー", written: "タクシー" });
  });

  it("takes no spelling when her German does not match the entry", () => {
    assert.equal(dictionaryForm("inu", "Katze", WADOKU), null);
  });

  it("tokenizes her text, keeping the punctuation that becomes a pause", () => {
    assert.deepEqual(tokenize("Ashita/asa"), [{ romaji: "ashita" }, { punct: "/" }, { romaji: "asa" }]);
    assert.deepEqual(tokenize("Shin‘yuu").map((t) => t.romaji), ["shin'yuu"]);
  });

  it("gives particles inside a phrase their usual spelling, but a particle card is said as written", async () => {
    const phrase = planCard({ word: "Toire wa doko desu ka?", word_meaning: "Wo ist die Toilette?" }, { wadoku: WADOKU, kanjium: KANJIUM });
    const said = { トイレ: "トイレ", "トイレはどこですか？": "トイレワドコデスカ" };
    const resolved = await resolveText(phrase, async (t) => said[t] ?? "?");
    assert.equal(resolved.text, "トイレはどこですか？");
    // Right word by word, wrong as a whole: the whole goes out as kana.
    const misread = await resolveText(phrase, async (t) => (t === "トイレ" ? "トイレ" : "トイレワドコデス"));
    assert.equal(misread.text, "といれはどこですか？");
    const card = planCard({ word: "Wa", word_meaning: "Thema Partikel" }, { wadoku: WADOKU, kanjium: KANJIUM });
    assert.equal((await resolveText(card, async () => "ワ")).text, "わ");
  });

  it("refuses a spelling the engine reads as another word (いつ → 何時 → なんじ)", async () => {
    const plan = planCard({ word: "Itsu", word_meaning: "wann" }, { wadoku: WADOKU, kanjium: KANJIUM });
    const resolved = await resolveText(plan, async (t) => (t === "何時" ? "ナンジ" : "イツ"));
    assert.equal(resolved.text, "いつ");
  });

  it("uses 歯 for は (the engine would say the particle), and checks the accent against Kanjium", async () => {
    const plan = planCard({ word: "Ha", word_meaning: "Zahn" }, { wadoku: WADOKU, kanjium: KANJIUM });
    const resolved = await resolveText(plan, async () => "ハ");
    assert.equal(resolved.text, "歯");
    assert.deepEqual(resolved.checkWith.accents, [1]);
  });

  it("checks an accent only when VOICEVOX and Kanjium agree, heiban and odaka counting as one", () => {
    const plan = { checkWith: { accents: [2] } };
    const phrase = (accent, moras) => [{ accent, moras: Array(moras).fill({}) }];
    assert.deepEqual(decideAccent(plan, phrase(2, 2)), { checked: true, accent: null });
    // Kanjium 0 (heiban) and VOICEVOX's mora count are the same sound.
    assert.deepEqual(decideAccent({ checkWith: { accents: [0] } }, phrase(3, 3)), { checked: true, accent: null });
    // Disagreement with one Kanjium accent: Kanjium's is spoken, asterisk stays.
    assert.deepEqual(decideAccent({ checkWith: { accents: [1] } }, phrase(3, 3)), { checked: false, accent: 1 });
    // A phrase can never be checked.
    assert.deepEqual(decideAccent({ checked: false }, [...phrase(1, 3), ...phrase(2, 2)]), { checked: false, accent: null });
    // One mora has no contour to get wrong.
    assert.deepEqual(decideAccent({ checked: false }, phrase(1, 1)), { checked: true, accent: null });
  });

  it("compares sounds the way VOICEVOX writes its moras", () => {
    assert.ok(sameSound("キョオワ", "きょうわ"));
    assert.ok(sameSound("ホントウ", "ほんとう"));
    assert.ok(sameSound("エレベエタア", "えれべーたー"));
    assert.ok(sameSound("ドオユウイミデスカ", "どういういみですか"));
    assert.ok(!sameSound("マタワナソオ", "またはなそう"));
  });

  it("reads overrides keyed by her exact text", () => {
    const o = parseOverrides("# comment\nFun Pun\tふん、ぷん\n");
    assert.equal(o.get("Fun Pun"), "ふん、ぷん");
  });

  it("names a file after the card and what was said, so an edit gets a new file", () => {
    assert.match(wordSoundName(-1789389996994, "犬"), /^word-generated-1789389996994-[0-9a-f]{8}\.mp3$/);
    assert.notEqual(wordSoundName(-1, "犬"), wordSoundName(-1, "猫"));
  });
});
