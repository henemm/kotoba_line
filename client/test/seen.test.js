import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { onceToday, withMoment } from "../src/seen.js";

describe("seen.js (#228)", () => {
  it("records a once-a-day moment the first time on a day, not on every redraw", () => {
    const a = onceToday(undefined, "more_new_shown", "deck:1", "2026-09-19");
    assert.equal(a.record, true);
    const b = onceToday(a.lastDays, "more_new_shown", "deck:1", "2026-09-19");
    assert.equal(b.record, false);
  });

  it("counts each deck, and each new day, on its own", () => {
    const { lastDays } = onceToday(undefined, "more_new_shown", "deck:1", "2026-09-19");
    assert.equal(onceToday(lastDays, "more_new_shown", "hiragana", "2026-09-19").record, true);
    assert.equal(onceToday(lastDays, "more_new_shown", "deck:1", "2026-09-20").record, true);
  });

  it("keeps the newest moments when the device has been offline too long", () => {
    let pending = [];
    for (let i = 0; i < 5; i++) pending = withMoment(pending, { id: String(i) }, 3);
    assert.deepEqual(pending.map((m) => m.id), ["2", "3", "4"]);
  });
});
