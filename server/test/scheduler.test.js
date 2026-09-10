import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { orderEvents, previewIntervals, stateFromEvents } from "../src/scheduler.js";

const DAY = 86400;
const T0 = 1_760_000_000;
const ev = (id, rating, reviewed_at) => ({ id, rating, reviewed_at });

describe("stateFromEvents", () => {
  it("is undefined with no events", () => {
    assert.equal(stateFromEvents([]), undefined);
  });

  it("is deterministic — the same events always give the same state", () => {
    const events = [ev("a", 3, T0), ev("b", 1, T0 + DAY), ev("c", 3, T0 + 2 * DAY)];
    const first = stateFromEvents(events);
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(stateFromEvents(events), first);
    }
  });

  it("ignores the order events are handed over in", () => {
    const events = [ev("a", 3, T0), ev("b", 1, T0 + DAY), ev("c", 4, T0 + 2 * DAY)];
    assert.deepEqual(stateFromEvents([...events].reverse()), stateFromEvents(events));
  });

  it("breaks ties on id, so two devices in the same second agree", () => {
    // Same second, opposite input order. Without the id tiebreak the fold
    // order — and the resulting state — would differ.
    const a = [ev("aaa", 1, T0), ev("bbb", 4, T0)];
    const b = [ev("bbb", 4, T0), ev("aaa", 1, T0)];
    assert.deepEqual(stateFromEvents(b), stateFromEvents(a));
    assert.deepEqual(
      orderEvents(b).map((e) => e.id),
      ["aaa", "bbb"],
    );
  });

  it("counts a lapse when a review card is failed", () => {
    // Good until the card is in review, then Again.
    const learn = [ev("a", 3, T0), ev("b", 3, T0 + 600), ev("c", 3, T0 + 4 * DAY)];
    assert.equal(stateFromEvents(learn).lapses, 0);

    const lapsed = [...learn, ev("d", 1, T0 + 12 * DAY)];
    assert.equal(stateFromEvents(lapsed).lapses, 1);
  });

  it("counts every event as a rep", () => {
    const events = [ev("a", 3, T0), ev("b", 1, T0 + DAY), ev("c", 3, T0 + 2 * DAY)];
    assert.equal(stateFromEvents(events).reps, 3);
  });

  it("schedules Easy further out than Good, and Good further than Again", () => {
    const at = (rating) => stateFromEvents([ev("a", 3, T0), ev("b", rating, T0 + DAY)]).due_at;
    assert.ok(at(1) < at(3), "Again should come back sooner than Good");
    assert.ok(at(3) < at(4), "Good should come back sooner than Easy");
  });

  it("reports last_review as the newest event", () => {
    const state = stateFromEvents([ev("a", 3, T0), ev("b", 3, T0 + 5 * DAY)]);
    assert.equal(state.last_review, T0 + 5 * DAY);
  });

  it("refuses a rating it does not know", () => {
    assert.throws(() => stateFromEvents([ev("a", 0, T0)]), /unknown rating/);
    assert.throws(() => stateFromEvents([ev("a", 7, T0)]), /unknown rating/);
  });
});

describe("fuzz is off", () => {
  it("gives the same due date on every run, so a replay is a rebuild", () => {
    // With enable_fuzz on, ts-fsrs randomises each interval by a few percent
    // and this assertion fails intermittently — which is exactly why §3's
    // "delete card_state and replay" promise needs it off.
    const events = [
      ev("a", 3, T0),
      ev("b", 3, T0 + 600),
      ev("c", 3, T0 + 5 * DAY),
      ev("d", 3, T0 + 20 * DAY),
    ];
    const runs = Array.from({ length: 20 }, () => stateFromEvents(events).due_at);
    assert.equal(new Set(runs).size, 1, `expected one due date, got ${new Set(runs).size}`);
  });
});

describe("previewing what each button would do (design 41)", () => {
  it("gives four intervals, worse to better", () => {
    const now = new Date("2026-09-10T00:00:00Z");
    const p = previewIntervals([], now);
    assert.deepEqual(Object.keys(p).sort(), ["1", "2", "3", "4"]);
    // The row on screen reads left to right as worse to better, so the
    // numbers under it have to as well — otherwise the tint and the figure
    // would disagree.
    assert.ok(p[1] < p[2] && p[2] < p[3] && p[3] < p[4], JSON.stringify(p));
  });

  it("takes the card's own history into account", () => {
    const now = new Date("2026-09-10T00:00:00Z");
    const at = (days) => Math.floor(now.getTime() / 1000) - days * 86400;
    const known = previewIntervals(
      [
        { id: "a", card_id: 1, rating: 3, reviewed_at: at(9) },
        { id: "b", card_id: 1, rating: 3, reviewed_at: at(4) },
        { id: "c", card_id: 1, rating: 4, reviewed_at: at(1) },
      ],
      now,
    );
    // A card answered well three times must not be offered the same "good"
    // interval as one seen for the first time.
    assert.ok(known[3] > previewIntervals([], now)[3]);
  });

  it("does not move the card it is previewing", () => {
    const now = new Date("2026-09-10T00:00:00Z");
    const events = [{ id: "a", card_id: 1, rating: 3, reviewed_at: Math.floor(now / 1000) - 86400 }];
    const before = stateFromEvents(events);
    previewIntervals(events, now);
    assert.deepEqual(stateFromEvents(events), before);
  });
});
