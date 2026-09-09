import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { query } from "../src/api.js";
import { weakestTopic } from "../src/screens/practise.js";
import { MODES, modeByKey } from "../src/modes.js";
import { endDotOffset, levelProgress, visibleTopics } from "../src/screens/stats.js";

describe("query strings", () => {
  it("omits what is not set, so /api/queue gets no empty filters", () => {
    assert.equal(query({ limit: 20, tag: undefined, deck: "", only: null }), "?limit=20");
    assert.equal(query({}), "");
    assert.equal(query(), "");
  });

  it("keeps a zero", () => {
    assert.equal(query({ since: 0 }), "?since=0");
  });

  it("escapes a value", () => {
    assert.equal(query({ q: "small talk" }), "?q=small+talk");
  });
});

describe("the four lines", () => {
  it("are the four modes, each with its own colour", () => {
    assert.deepEqual(MODES.map((m) => m.key), ["choose", "listen", "speak", "flip"]);
    assert.equal(new Set(MODES.map((m) => m.colour)).size, 4);
    assert.equal(modeByKey("flip").jp, "めくる");
    assert.equal(modeByKey("nope"), undefined);
  });
});

describe("which topic is furthest behind", () => {
  const topics = (...t) => ({ topics: t });

  it("is the smallest share seen, not the smallest count", () => {
    const stats = topics(
      { tag: "health", total: 52, seen: 40 },
      { tag: "time", total: 43, seen: 4 },
      { tag: "family", total: 27, seen: 20 },
    );
    assert.equal(weakestTopic(stats).tag, "time");
  });

  it("ignores a topic too small to make a session", () => {
    // konbini holds three cards in the real deck (docs/tagging.md). Without a
    // floor it would always win "furthest behind" and offer a session of three.
    const stats = topics(
      { tag: "konbini", total: 3, seen: 0 },
      { tag: "health", total: 52, seen: 30 },
    );
    assert.equal(weakestTopic(stats).tag, "health");
  });

  it("is undefined when nothing qualifies", () => {
    assert.equal(weakestTopic(topics({ tag: "konbini", total: 3, seen: 0 })), undefined);
    assert.equal(weakestTopic({ topics: [] }), undefined);
    assert.equal(weakestTopic(undefined), undefined);
  });
});

describe("the level bar", () => {
  it("fills in proportion to progress through the level", () => {
    // Level 10 spans 5,500 to 6,600.
    const at = (xp) => levelProgress({ xp, xpForLevel: 5500, xpForNextLevel: 6600 }).filled;
    assert.equal(at(5500), 0, "just levelled up");
    assert.equal(at(6050), 6, "halfway");
    assert.equal(at(6600), 12, "at the next threshold");
  });

  it("reports what is left to the next level", () => {
    assert.equal(
      levelProgress({ xp: 5764, xpForLevel: 5500, xpForNextLevel: 6600 }).remaining,
      836,
    );
  });

  it("does not divide by zero or overflow the bar", () => {
    assert.equal(levelProgress({ xp: 0, xpForLevel: 0, xpForNextLevel: 0 }).filled, 0);
    assert.equal(levelProgress({ xp: 9999, xpForLevel: 0, xpForNextLevel: 100 }).filled, 12);
    assert.equal(levelProgress({ xp: 9999, xpForLevel: 0, xpForNextLevel: 100 }).remaining, 0);
  });
});

describe("the topic bar's end dot", () => {
  it("is clamped inside the track at both extremes", () => {
    // Half the dot is 7px; at the ends it has to tuck in or hang off the edge.
    assert.equal(endDotOffset(0), "-3px");
    assert.equal(endDotOffset(3), "-3px");
    assert.equal(endDotOffset(50), "-7px");
    assert.equal(endDotOffset(97), "-7px");
    assert.equal(endDotOffset(98), "-11px");
    assert.equal(endDotOffset(100), "-11px");
  });
});

describe("which topics the Stats screen draws", () => {
  const topics = [
    { tag: "family", total: 27, seen: 2 },
    { tag: "food", total: 18, seen: 1 },
    { tag: "health", total: 52, seen: 11 },
    { tag: "money", total: 9, seen: 1 },
    { tag: "school", total: 12, seen: 2 },
    { tag: "small talk", total: 22, seen: 3 },
    { tag: "time", total: 43, seen: 5 },
    { tag: "konbini", total: 3, seen: 0 },
  ];

  it("leaves out a topic she has never met", () => {
    const { seen } = visibleTopics(topics, false);
    assert.ok(!seen.some((t) => t.tag === "konbini"), "0 seen is absence, not progress");
    assert.equal(seen.length, 7);
  });

  it("truncates past five and reports how many are behind the rule", () => {
    const { shown, hidden } = visibleTopics(topics, false);
    assert.equal(shown.length, 5);
    assert.equal(hidden, 2);
  });

  it("shows everything once expanded", () => {
    const { shown, hidden } = visibleTopics(topics, true);
    assert.equal(shown.length, 7);
    assert.equal(hidden, 0);
  });

  it("does not offer a rule when there is nothing behind it", () => {
    assert.equal(visibleTopics(topics.slice(0, 3), false).hidden, 0);
    assert.equal(visibleTopics([], false).shown.length, 0);
    assert.equal(visibleTopics(undefined, false).shown.length, 0);
  });
});
