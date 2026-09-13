import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PATIENCE_MS, REQUEST_TIMEOUT_MS, answerSoon } from "../src/api.js";
import { stillToAnswer } from "../src/queue.js";

/**
 * #106. What the screens do with these was measured by driving the real app
 * in WebKit with every /api/ request left hanging (the commit message has the
 * numbers); these pin the two pieces of logic that decide it.
 */
describe("waiting for the server only briefly (#106)", () => {
  it("is well short of the point a request is given up", () => {
    assert.ok(PATIENCE_MS * 4 <= REQUEST_TIMEOUT_MS);
  });

  it("hands back an answer that arrives in time", async () => {
    assert.deepEqual(await answerSoon(Promise.resolve(15), 50), { value: 15 });
  });

  it("hands back a failure as a value, so the caller can tell it from a slow answer", async () => {
    const err = new Error("offline");
    assert.deepEqual(await answerSoon(Promise.reject(err), 50), { error: err });
  });

  it("gives up waiting on a stalled answer, and a late failure is not left unhandled", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let fail;
    const stalled = new Promise((_, reject) => {
      fail = reject;
    });
    const outcome = answerSoon(stalled, PATIENCE_MS);
    t.mock.timers.tick(PATIENCE_MS);
    assert.equal(await outcome, undefined);
    // An unhandled rejection here would fail the whole test file.
    fail(new Error("timed out"));
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe("a cached queue, used when the server is slow (#106)", () => {
  // Cached at 10:00:00, in ms as `Date.now()` writes it.
  const at = Date.UTC(2026, 8, 13, 1, 0, 0);
  const s = (ms) => Math.floor(ms / 1000);
  const cached = { cardIds: [1, 2, 3, 4, -7], at };

  it("runs every card when nothing has been answered since", () => {
    assert.deepEqual(stillToAnswer(cached), [1, 2, 3, 4, -7]);
  });

  it("leaves out a card answered after it was cached, even once the answer has been sent", () => {
    // The outbox is empty: this morning's session went up. The map remembers.
    const answered = { 2: s(at) + 3600, "-7": s(at) + 60 };
    assert.deepEqual(stillToAnswer(cached, [], answered), [1, 3, 4]);
  });

  it("keeps a card whose last answer the server already knew when it built the queue", () => {
    assert.deepEqual(stillToAnswer(cached, [], { 3: s(at) - 86400 }), [1, 2, 3, 4, -7]);
  });

  it("still leaves out anything waiting in the outbox, however old", () => {
    const waiting = [{ card_id: 4, reviewed_at: s(at) - 86400 }];
    assert.deepEqual(stillToAnswer(cached, waiting, {}), [1, 2, 3, -7]);
  });
});
