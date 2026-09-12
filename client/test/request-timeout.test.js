import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OfflineError, REQUEST_TIMEOUT_MS, api } from "../src/api.js";

/**
 * A stalled connection, not a dead one: `fetch()` neither resolves nor
 * rejects, which is what a weak signal does and a dropped one does not. A
 * real `fetch` rejects such a request when its `signal` fires — this stub
 * does the same, so ticking the fake clock exercises the actual timeout
 * path in `request()` rather than asserting the mock's own behaviour.
 */
function stalledFetch() {
  return (url, opts) =>
    new Promise((resolve, reject) => {
      // No signal at all is a real shape too — the one `request()` had before
      // it started making its own — and it must hang exactly as a missing
      // timeout would, not throw, or this stub would pass for the wrong
      // reason regardless of whether `request()` ever gives up.
      opts.signal?.addEventListener("abort", () =>
        reject(new DOMException("stalled", "AbortError")),
      );
    });
}

describe("a request that stalls instead of failing (found while chasing a black screen on a weak signal)", () => {
  it("gives up after the timeout and reports offline, rather than hanging forever", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const original = globalThis.fetch;
    globalThis.fetch = stalledFetch();
    t.after(() => {
      globalThis.fetch = original;
    });

    const outcome = assert.rejects(api.me(), OfflineError);
    t.mock.timers.tick(REQUEST_TIMEOUT_MS);
    await outcome;
  });

  it("still resolves normally when the server answers well inside the timeout", async (t) => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ handle: "charlotte" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    t.after(() => {
      globalThis.fetch = original;
    });

    const result = await api.me();
    assert.equal(result.handle, "charlotte");
  });
});
