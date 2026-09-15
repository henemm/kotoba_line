import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXAMPLE_SOUNDS, TOFUGU_COMMIT, exampleSoundName, lingualibreSpeaker } from "../lib/example-sounds.js";
import { soundMediaName } from "../lib/kana-sounds.js";

// The table is pinned by hand from a measurement (see the module's comment);
// these guard against a row being mistyped or a rule being quietly broken.
describe("the example words' recordings (#158, v87)", () => {
  it("are only by the native speakers the module names", () => {
    const speakers = new Set(EXAMPLE_SOUNDS.filter((s) => s.source === "lingualibre").map((s) => s.speaker));
    assert.deepEqual([...speakers].sort(), ["Higa4", "葵心"]);
    assert.ok(EXAMPLE_SOUNDS.every((s) => ["lingualibre", "tofugu"].includes(s.source)));
    assert.equal(lingualibreSpeaker("LL-Q5287 (jpn)-CKali-アジア.wav"), "CKali");
  });

  it("each name one word, read in kana, once", () => {
    const readings = EXAMPLE_SOUNDS.map((s) => s.reading);
    assert.equal(new Set(readings).size, readings.length);
    assert.ok(readings.every((r) => /^[぀-ヿー]+$/.test(r)), "a reading in kana");
    for (const s of EXAMPLE_SOUNDS.filter((s) => s.source === "tofugu")) {
      assert.equal(s.file, `lib/mp3/${s.written}【${s.reading}】.mp3`);
      assert.ok(s.pitch > 0, `${s.file} has its measured pitch`);
    }
    for (const s of EXAMPLE_SOUNDS.filter((s) => s.source === "lingualibre")) {
      assert.equal(s.file, `LL-Q5287 (jpn)-${s.speaker}-${s.written}.wav`);
    }
  });

  it("are pinned and levelled", () => {
    assert.match(TOFUGU_COMMIT, /^[0-9a-f]{40}$/);
    for (const s of EXAMPLE_SOUNDS) {
      assert.match(s.hash, /^[0-9a-f]{40}$/, s.file);
      assert.ok(Number.isInteger(s.steps) && Math.abs(s.steps) <= 8, `${s.file}: ${s.steps} steps`);
    }
  });

  it("puts Tofugu's higher (Kansai) voice after every other recording", () => {
    const firstHigh = EXAMPLE_SOUNDS.findIndex((s) => s.pitch > 165);
    assert.ok(firstHigh > 0);
    assert.ok(EXAMPLE_SOUNDS.slice(firstHigh).every((s) => s.pitch > 165));
  });

  it("are written under names of their own, not as kana sounds", () => {
    const names = EXAMPLE_SOUNDS.map(exampleSoundName);
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.every((n) => /^example-[0-9a-f]{16}\.mp3$/.test(n)));
    assert.ok(!names.some((n) => n.startsWith(soundMediaName("あ").slice(0, 5))), "not kana-: sw.js and status.sh count those");
  });
});
