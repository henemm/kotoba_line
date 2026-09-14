import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODES } from "../src/modes.js";
import { appName, modeName, showsScript, shownWord, visibleModes, wordRomaji } from "../src/script.js";
import { flipsMeaningFirst, meaningPool } from "../src/screens/session.js";

describe("Japanese script off (#135)", () => {
  const kaishi = { word: "大丈夫", word_furigana: "大丈夫[だいじょうぶ]", word_reading: "だいじょうぶ" };
  // Her own card: `word_furigana` is always NULL there (server/src/cards.js).
  const ownWithReading = { word: "食べる", word_furigana: null, word_reading: "たべる" };
  const ownWithoutReading = { word: "食べる", word_furigana: null, word_reading: null };

  it("shows the word in romaji, written the way it is typed", () => {
    assert.equal(shownWord(kaishi, false), "daijoubu");
    assert.equal(shownWord(ownWithReading, false), "taberu");
    assert.equal(showsScript(kaishi, false), false);
  });

  it("shows the Japanese rather than a guess where no reading exists", () => {
    assert.equal(wordRomaji(ownWithoutReading), undefined);
    assert.equal(shownWord(ownWithoutReading, false), "食べる");
    // …and says it did, so the word keeps its Japanese font.
    assert.equal(showsScript(ownWithoutReading, false), true);
  });

  it("changes nothing with the script on", () => {
    assert.equal(shownWord(kaishi, true), "大丈夫");
    assert.equal(showsScript(kaishi, true), true);
  });

  it("sets a word from her Noji lists in Latin type, whatever the switch (#139)", () => {
    // What Kaishi could not fill in arrives as the romaji she typed into Noji.
    const fromNoji = { word: "Ōkii", word_furigana: null, word_reading: null };
    assert.equal(showsScript(fromNoji, true), false);
    assert.equal(showsScript(fromNoji, false), false);
  });

  it("names the app in Latin letters with the script off (#139)", () => {
    assert.equal(appName(true), "ことばライン");
    assert.equal(appName(false), "Kotoba Line");
  });

  it("names a mode in English instead of Japanese", () => {
    const choose = MODES.find((m) => m.key === "choose");
    assert.equal(modeName(choose, true), "選ぶ");
    assert.equal(modeName(choose, false), "Pick the meaning");
  });
});

describe("hidden practice lines (#133)", () => {
  it("leaves out the hidden lines, in the lines' own order", () => {
    assert.deepEqual(
      visibleModes(["listen", "type"]).map((m) => m.key),
      ["choose", "speak", "flip"],
    );
  });

  it("shows every line rather than none", () => {
    assert.equal(visibleModes(MODES.map((m) => m.key)).length, MODES.length);
    assert.equal(visibleModes(undefined).length, MODES.length);
  });
});

describe("選ぶ's wrong answers (#135, #137)", () => {
  // Furigana the way the deck writes it: the bracket follows the kanji only.
  const kaishi = (id, word, furigana, reading, meaning) => ({ id, word, word_furigana: furigana, word_reading: reading, word_meaning: meaning });
  const iru = kaishi(1, "居る", "居[い]る", "いる", "to exist");
  const iruNeed = kaishi(2, "要る", "要[い]る", "いる", "to need");
  const taberu = kaishi(3, "食べる", "食[た]べる", "たべる", "to eat");
  const mine = (id, word, meaning) => ({ id, word, word_reading: null, word_meaning: meaning, list_name: "100 vokabeln" });
  const densha = mine(-3, "Densha", "Zug");
  const basu = mine(-2, "Basu", "Bus");
  const pool = [iru, iruNeed, taberu, densha, basu];

  it("never offers a look-alike word's meaning with the script off", () => {
    assert.deepEqual(meaningPool(iru, pool, false).map((c) => c.id), [3]);
  });

  it("asks めくる from her Noji lists German first, and the Kaishi deck word first (#137)", () => {
    assert.equal(flipsMeaningFirst(densha), true);
    assert.equal(flipsMeaningFirst(taberu), false);
    // A word she added in the app herself belongs to no list.
    assert.equal(flipsMeaningFirst({ ...taberu, list_name: null }), false);
  });

  it("keeps her German lists and the English deck apart", () => {
    assert.deepEqual(meaningPool(densha, pool, false).map((c) => c.id), [-2]);
    assert.ok(!meaningPool(taberu, pool, true).some((c) => c.list_name));
  });
});
