import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { query } from "../src/api.js";
import { weakestTopic } from "../src/screens/practise.js";
import { MODES, modeByKey } from "../src/modes.js";

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
