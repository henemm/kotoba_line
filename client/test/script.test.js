import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODES } from "../src/modes.js";
import { modeName, showsScript, shownWord, visibleModes, wordRomaji } from "../src/script.js";

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
