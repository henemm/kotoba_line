import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOPICS } from "../../import/lib/tagging.js";
import { TOPIC_KEYS, byTopicLabel, deckTopics, topicLabel } from "../src/topics.js";

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

describe("the topics of one of her decks (#209)", () => {
  const cards = [
    { id: -1, deck: "personal", deck_id: 7, tags: ["food", "shopping"] },
    { id: -2, deck: "personal", deck_id: 7, tags: ["food"] },
    { id: -3, deck: "personal", deck_id: 7, tags: [] },
    { id: -4, deck: "personal", deck_id: 8, tags: ["train"] },
    { id: -5, deck: "personal", deck_id: 7, tags: ["time"], deleted_at: 5 },
    // Kaishi's cards have no deck_id; a topic of theirs is not in her deck.
    { id: 9, deck: "kaishi", tags: ["food", "family"] },
  ];

  it("counts only that deck's live cards, most cards first", () => {
    assert.deepEqual(deckTopics(cards, 7), [
      { tag: "food", total: 2 },
      { tag: "shopping", total: 1 },
    ]);
  });

  it("is empty for a deck whose cards carry no topic", () => {
    assert.deepEqual(deckTopics(cards, 99), []);
  });
});
