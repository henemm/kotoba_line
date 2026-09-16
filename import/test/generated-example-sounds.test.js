import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENERATED_EXAMPLE_SOUNDS, generatedExampleSoundName } from "../lib/generated-example-sounds.js";

describe("generated-example-sounds (#183, gap a)", () => {
  it("has 92 rows, each a pitch agreed by pyopenjtalk and Kanjium", () => {
    assert.equal(GENERATED_EXAMPLE_SOUNDS.length, 92);
    for (const s of GENERATED_EXAMPLE_SOUNDS) {
      assert.equal(s.source, "generated");
      assert.equal(s.written, s.reading, `${s.reading}: a kana loanword has no separate kanji spelling`);
      assert.ok(Number.isInteger(s.pitch) && s.pitch >= 0 && s.pitch <= 6, `${s.reading} ${s.pitch}`);
    }
  });

  it("names every row's file uniquely, with the ordinary example- prefix (not kana-, which sw.js keeps outside the cache cap) and a generated- marker apart from the human recordings", () => {
    const names = GENERATED_EXAMPLE_SOUNDS.map(generatedExampleSoundName);
    assert.equal(new Set(names).size, names.length);
    for (const n of names) assert.match(n, /^example-generated-[0-9a-f]+\.mp3$/);
  });
});
