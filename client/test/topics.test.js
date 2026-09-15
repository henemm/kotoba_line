import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOPICS } from "../../import/lib/tagging.js";
import { TOPIC_KEYS, byTopicLabel, topicLabel } from "../src/topics.js";

describe("topic names in German (v75)", () => {
  it("names every topic the import can write, and no other", () => {
    assert.deepEqual([...TOPIC_KEYS].sort(), [...TOPICS].sort());
  });

  it("draws the deck's topics in German and hers as she wrote them", () => {
    assert.equal(topicLabel("food"), "Essen");
    assert.equal(topicLabel("host family"), "Gastfamilie");
    assert.equal(topicLabel("Anime"), "Anime");
  });

  it("orders by the German name", () => {
    // Arbeit, Essen, Zug — not food, train, work.
    assert.deepEqual(["train", "food", "work"].sort(byTopicLabel), ["work", "food", "train"]);
  });
});
