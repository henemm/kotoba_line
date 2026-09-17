import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGeneratedAudio, wordSound } from "../src/sound.js";

/**
 * #185, 2026-09-17: what a word's ♪ plays and whose voice it is. Two sources
 * only — native (the deck's, or one added on her device) and generated. The
 * chip that offers a native recording depends on `deckNative`, which is the
 * bug this pins: 何 has a real Kaishi recording and was offered one anyway.
 */
describe("wordSound (#185)", () => {
  it("tells a generated file from a recorded one by its name, as the import writes it", () => {
    assert.equal(isGeneratedAudio("kana-generated-kya.mp3"), true);
    assert.equal(isGeneratedAudio("example-generated-wapuro.mp3"), true);
    assert.equal(isGeneratedAudio("kaishi_1234.mp3"), false);
    assert.equal(isGeneratedAudio("practice/native-9f8e7d6c.mp3"), false);
    assert.equal(isGeneratedAudio(null), false);
  });

  it("a deck recording is native and leaves nothing to add, even if one was added", () => {
    const added = { id: "x", file: "practice/native-x.mp3" };
    assert.deepEqual(wordSound({ word_audio: "nani.mp3" }, added), {
      file: "nani.mp3",
      source: "native",
      deckNative: true,
      recording: null,
    });
  });

  it("an added native recording plays where the deck has none, and can be edited", () => {
    const added = { id: "x", file: "practice/native-x.mp3" };
    const sound = wordSound({ word_audio: null }, added);
    assert.equal(sound.file, added.file);
    assert.equal(sound.source, "native");
    assert.equal(sound.deckNative, false);
    assert.equal(sound.recording, added);
  });

  it("a native recording outranks a generated one; a generated one alone is labelled as such", () => {
    const added = { id: "x", file: "practice/native-x.mp3" };
    assert.equal(wordSound({ word_audio: "example-generated-a.mp3" }, added).file, added.file);
    assert.deepEqual(wordSound({ word_audio: "example-generated-a.mp3" }), {
      file: "example-generated-a.mp3",
      source: "synth",
      deckNative: false,
      recording: null,
    });
  });

  it("nothing at all is no file and no source — the ♪ is absent, not the phone's voice", () => {
    assert.deepEqual(wordSound({ word: "Toire wa doko desu ka?" }), {
      file: null,
      source: "none",
      deckNative: false,
      recording: null,
    });
  });
});
