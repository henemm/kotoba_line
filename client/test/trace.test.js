import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KEEP_MS, logPath, trimmed, unsent } from "../src/trace.js";

describe("trace.js, the flight recorder (#299)", () => {
  it("keeps a week and the newest lines under the cap", () => {
    const now = 10 * KEEP_MS;
    const lines = [
      { s: 1, t: now - KEEP_MS - 1, k: "start" },
      { s: 2, t: now - 1000, k: "req" },
      { s: 3, t: now - 500, k: "req" },
      { s: 4, t: now, k: "stuck" },
    ];
    assert.deepEqual(trimmed(lines, now).map((l) => l.s), [2, 3, 4]);
    assert.deepEqual(trimmed(lines, now, { max: 2 }).map((l) => l.s), [3, 4]);
  });

  it("sends only what the server has not had, oldest first, in batches", () => {
    const lines = Array.from({ length: 7 }, (_, i) => ({ s: i + 1, t: i, k: "req" }));
    assert.deepEqual(unsent(lines, 4).map((l) => l.s), [5, 6, 7]);
    assert.deepEqual(unsent(lines, 0, 3).map((l) => l.s), [1, 2, 3]);
    assert.deepEqual(unsent(lines, 7), []);
  });

  it("never writes down what she searched for, only which deck a request was about", () => {
    assert.equal(logPath("GET /browse?q=taberu&page=0&pageSize=50"), "GET /browse");
    assert.equal(logPath("GET /queue?limit=60&deckKey=deck:1"), "GET /queue?deckKey=deck:1");
    assert.equal(logPath("POST /events"), "POST /events");
  });
});
