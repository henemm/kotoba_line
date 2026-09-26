import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decksToPreload } from "../src/queue.js";

describe("which decks are fetched ahead for offline (#306)", () => {
  it("every deck that can be practised, and no locked or empty one", () => {
    const decks = [
      { key: "kaishi", cards: 1526 },
      { key: "hiragana", cards: 104 },
      { key: "deck:1", cards: 0 }, // hers, just made
      { key: "travel:1", cards: 21 },
      { key: "travel:2", cards: 44, locked: true }, // #252: not open yet
    ];
    assert.deepEqual(decksToPreload(decks), ["kaishi", "hiragana", "travel:1"]);
    assert.deepEqual(decksToPreload(undefined), []);
  });
});
