import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

/**
 * playTracked() (#185): the voice circles' play ring is driven by this, and
 * a voice circle only leaves its "playing" state when onEnded fires — stuck
 * forever (and its sibling disabled the whole time, see recordingBlock's
 * activeKind) if a real device's browser never rejects play() for a 404 or
 * a corrupt file, which is not guaranteed the way a synthetic test can make
 * it guaranteed. Isolates the mechanism with a fake Audio, per CLAUDE.md.
 */

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.currentTime = 0;
    this.duration = 0;
    this.paused = true;
    this.listeners = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  play() {
    this.paused = false;
    return nextPlayResult;
  }
  pause() {
    this.paused = true;
  }
  fire(type) {
    for (const fn of this.listeners[type] ?? []) fn();
  }
}

let lastAudio;
let nextPlayResult;

beforeEach(() => {
  nextPlayResult = Promise.resolve();
  globalThis.Audio = class extends FakeAudio {
    constructor(src) {
      super(src);
      lastAudio = this;
    }
  };
});

describe("playTracked (#185)", () => {
  it("reports progress from timeupdate and calls onEnded once, on ended", async () => {
    const { playTracked } = await import(`../src/audio.js?${Math.random()}`);
    const progress = [];
    let ended = 0;
    playTracked("practice/own-x.mp3", { onProgress: (p) => progress.push(p), onEnded: () => ended++ });

    lastAudio.duration = 10;
    lastAudio.currentTime = 5;
    lastAudio.fire("timeupdate");
    lastAudio.fire("ended");

    assert.deepEqual(progress, [0.5]);
    assert.equal(ended, 1);
  });

  it("calls onEnded when play() itself rejects", async () => {
    nextPlayResult = Promise.reject(new Error("NotAllowedError"));
    const { playTracked } = await import(`../src/audio.js?${Math.random()}`);
    let ended = 0;
    playTracked("practice/missing.mp3", { onEnded: () => ended++ });

    // Let the module's own `.catch()` on the rejected play() promise run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(ended, 1);
  });

  it("calls onEnded when the media element fires its own error event, even if play() resolved", async () => {
    const { playTracked } = await import(`../src/audio.js?${Math.random()}`);
    let ended = 0;
    playTracked("practice/corrupt.mp3", { onEnded: () => ended++ });

    // play() already resolved (FakeAudio's default), so only the error
    // event is what a real 404 fires late, after playback appeared to start.
    lastAudio.fire("error");

    assert.equal(ended, 1, "a voice circle would otherwise stay \"playing\" forever, and its sibling stays disabled");
  });

  it("does not report progress while duration is unknown (0/NaN)", async () => {
    const { playTracked } = await import(`../src/audio.js?${Math.random()}`);
    const progress = [];
    playTracked("practice/own-x.mp3", { onProgress: (p) => progress.push(p) });

    lastAudio.duration = 0;
    lastAudio.currentTime = 0;
    lastAudio.fire("timeupdate");

    assert.deepEqual(progress, []);
  });

  it("calls onEnded when something else interrupts with stop(), not just on natural completion", async () => {
    // A voice circle waits on onEnded to leave its "playing" state — without
    // this, cancelling out of "Übung verlassen?" after tapping a recording
    // left that circle's ring frozen and its sibling disabled for the rest
    // of the card (code review, 2026-09-17: askToLeave() already calls
    // stop() before the confirmation sheet even shows).
    const { playTracked, stop } = await import(`../src/audio.js?${Math.random()}`);
    let ended = 0;
    playTracked("practice/own-x.mp3", { onEnded: () => ended++ });

    stop();

    assert.equal(ended, 1);
    assert.equal(lastAudio.paused, true);
  });

  it("does not call onEnded twice for one interruption", async () => {
    const { playTracked, stop } = await import(`../src/audio.js?${Math.random()}`);
    let ended = 0;
    playTracked("practice/own-x.mp3", { onEnded: () => ended++ });

    stop();
    stop(); // nothing left to interrupt the second time

    assert.equal(ended, 1);
  });

  it("a stop() after natural completion does not re-report it as interrupted", async () => {
    const { playTracked, stop } = await import(`../src/audio.js?${Math.random()}`);
    let ended = 0;
    playTracked("practice/own-x.mp3", { onEnded: () => ended++ });

    lastAudio.fire("ended");
    stop();

    assert.equal(ended, 1);
  });
});
