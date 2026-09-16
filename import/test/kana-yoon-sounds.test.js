import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { YOON } from "../lib/kana.js";
import { yoonSoundFile, yoonSoundMediaName } from "../lib/kana-yoon-sounds.js";

describe("kana-yoon-sounds (#183)", () => {
  it("names a yōon's file by both characters' code points, unlike a single kana", () => {
    assert.equal(yoonSoundMediaName("きゃ"), "kana-0304d-03083.mp3");
    // き alone (soundMediaName in kana-sounds.js) would collide with きゃ, きゅ, きょ
    // on one code point; this is why yōon get their own naming function.
    assert.notEqual(yoonSoundMediaName("きゃ"), yoonSoundMediaName("きゅ"));
    assert.notEqual(yoonSoundMediaName("きゃ"), yoonSoundMediaName("きょ"));
  });

  it("gives hiragana and katakana yōon the same file", () => {
    assert.equal(yoonSoundMediaName("きゃ"), yoonSoundMediaName("キャ"));
  });

  it("has all 33 rows named, one file each", () => {
    assert.equal(YOON.length, 33);
    const files = YOON.map(([kana]) => yoonSoundFile(kana));
    assert.ok(files.every((f) => typeof f === "string"));
    assert.equal(new Set(files).size, 33);
  });

  it("returns null for anything that is not one of the 33", () => {
    assert.equal(yoonSoundFile("あ"), null);
    assert.equal(yoonSoundFile("ア"), null);
  });
});
