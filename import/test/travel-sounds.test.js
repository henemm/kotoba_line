import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseTravel } from "../lib/travel.js";
import { TRAVEL_SOUNDS, travelSoundMediaName } from "../lib/travel-sounds.js";

/**
 * #252: the two phrases of Reise's own that have a human recording on
 * Wikimedia Commons. The rows are pinned by sha1, so what a test can check
 * without the network is that they still describe cards that exist.
 */
describe("the travel phrases' human recordings", () => {
  const rows = parseTravel(readFileSync(new URL("../travel.tsv", import.meta.url), "utf8"));

  it("names cards travel.tsv actually adds, with the same word", () => {
    const added = new Map(rows.filter((r) => r.id).map((r) => [r.id, r.word]));
    for (const sound of TRAVEL_SOUNDS) {
      assert.equal(added.get(sound.cardId), sound.word, `card ${sound.cardId}`);
    }
  });

  it("pins each recording by its sha1 and uploader, as the kana ones are", () => {
    for (const sound of TRAVEL_SOUNDS) {
      assert.match(sound.sha1, /^[0-9a-f]{40}$/);
      assert.ok(sound.user && sound.licence, sound.commons);
      assert.match(sound.commons, /^Ja-.+\.(ogg|oga)$/);
    }
  });

  it("files them under the card they belong to", () => {
    assert.equal(travelSoundMediaName({ cardId: 9000000000002 }), "travel-9000000000002.mp3");
  });
});
