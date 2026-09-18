import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

/**
 * say()'s `onEnded` (#218 follow-up, 2026-09-18): a ♪ button's tap-ring
 * lasts ~80ms, which said "the tap arrived" but nothing about a recording
 * that plays for several more seconds, or a synthesised sentence read at
 * 0.85x. `onEnded` is what lets the button show it is still talking for as
 * long as that actually takes — recording or synthesis alike, one call,
 * whatever happens. Isolates the mechanism with fakes, per CLAUDE.md: a real
 * browser's speechSynthesis.cancel() ordering during a fast card change is
 * not something a synthetic test can force reliably otherwise.
 */

class FakeAudio {
  constructor(src) {
    this.src = src;
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

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}

let lastAudio;
let nextPlayResult;
let utterances;

beforeEach(() => {
  nextPlayResult = Promise.resolve();
  utterances = [];
  globalThis.Audio = class extends FakeAudio {
    constructor(src) {
      super(src);
      lastAudio = this;
    }
  };
  globalThis.SpeechSynthesisUtterance = FakeUtterance;
  globalThis.speechSynthesis = {
    getVoices: () => [],
    speak: (u) => utterances.push(u),
    cancel: () => {},
  };
});

describe("say() (#218 follow-up)", () => {
  it("calls onEnded once when a recording ends naturally, never touching speech", async () => {
    const { say } = await import(`../src/audio.js?${Math.random()}`);
    let ended = 0;
    say("思う", "practice/omou.mp3", { onEnded: () => ended++ });

    lastAudio.fire("ended");

    assert.equal(ended, 1);
    assert.equal(utterances.length, 0);
  });

  it("falls back to speech when the file fails, and onEnded comes from the utterance", async () => {
    nextPlayResult = Promise.reject(new Error("NotSupportedError"));
    const { say } = await import(`../src/audio.js?${Math.random()}`);
    let ended = 0;
    say("思う", "practice/missing.mp3", { onEnded: () => ended++ });

    // Let the rejected play() promise's catch, and the fallback it triggers, run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(utterances.length, 1, "should have fallen back to one utterance");
    assert.equal(ended, 0, "not yet — the utterance has not ended");
    utterances[0].onend();
    assert.equal(ended, 1);
  });

  it("calls onEnded once when stop() interrupts a recording mid-play", async () => {
    const { say, stop } = await import(`../src/audio.js?${Math.random()}`);
    let ended = 0;
    say("思う", "practice/omou.mp3", { onEnded: () => ended++ });

    stop();

    assert.equal(ended, 1);
    assert.equal(lastAudio.paused, true);
  });

  it("a later stray 'error' from an already-interrupted recording does not clobber a newer say()'s own onEnded", async () => {
    // #218 follow-up: speechSynthesis.cancel() does not reliably skip the
    // cancelled utterance's own end/error event, and an interrupted
    // recording's "error" can likewise arrive late — after a second say()
    // already started. Without the token guard, that stray event clears the
    // *new* call's currentInterrupted, and its own onEnded never fires.
    const { say, stop } = await import(`../src/audio.js?${Math.random()}`);
    let endedA = 0;
    let endedB = 0;

    say("思う", "practice/omou.mp3", { onEnded: () => endedA++ });
    const audioA = lastAudio;
    stop(); // interrupts A — endedA fires once, synchronously
    assert.equal(endedA, 1);

    say("聞く", "practice/kiku.mp3", { onEnded: () => endedB++ });
    const audioB = lastAudio;
    assert.notEqual(audioA, audioB);

    // A's own "error" arrives late, after B has already started.
    audioA.fire("error");
    assert.equal(endedA, 1, "A's onEnded must not fire a second time");
    assert.equal(endedB, 0, "B must not be reported ended by A's stray event");

    // B still reports its own ending normally afterward.
    audioB.fire("ended");
    assert.equal(endedB, 1);
  });

  it("does not call onEnded twice for one interruption", async () => {
    const { say, stop } = await import(`../src/audio.js?${Math.random()}`);
    let ended = 0;
    say("思う", "practice/omou.mp3", { onEnded: () => ended++ });

    stop();
    stop();

    assert.equal(ended, 1);
  });
});
