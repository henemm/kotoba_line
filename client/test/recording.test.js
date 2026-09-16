import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

/**
 * #185, 2026-09-16: the mic indicator stayed lit after a finished recording.
 * Two leaks, closed in recording.js — a caller that never calls `stop()`
 * (the card changed, the screen closed) used to leave the stream running
 * forever, and so did a recorder that died on its own. Fake `MediaRecorder`
 * and `getUserMedia` isolate the mechanism per CLAUDE.md, since neither is
 * available under `node --test` and the mic indicator itself is an iOS
 * Dynamic Island detail no test here can see — only Henning's phone can.
 */

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  #tracks = [new FakeTrack()];
  getTracks() {
    return this.#tracks;
  }
}

const recorders = [];

class FakeRecorder {
  static isTypeSupported = () => false;

  #listeners = {};

  constructor(stream) {
    this.stream = stream;
    recorders.push(this);
  }
  addEventListener(type, fn) {
    (this.#listeners[type] ??= []).push(fn);
  }
  start() {}
  stop() {
    for (const fn of this.#listeners.stop ?? []) fn();
  }
  /** A recorder that ends without anyone calling `stop()` — an iOS interruption, the PWA backgrounded. */
  dieWithoutStopping() {
    for (const fn of this.#listeners.error ?? []) fn({ error: new Error("interrupted") });
  }
}

const streams = [];

beforeEach(() => {
  recorders.length = 0;
  streams.length = 0;
  globalThis.MediaRecorder = FakeRecorder;
  // `navigator` is a read-only global under node --test; redefine it instead.
  Object.defineProperty(globalThis, "navigator", {
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          const stream = new FakeStream();
          streams.push(stream);
          return stream;
        },
      },
    },
    configurable: true,
  });
});

describe("recording.js releases the microphone (#185)", () => {
  it("stopAllRecording releases a stream nobody ever called stop() on", async () => {
    const { startRecording, stopAllRecording } = await import(`../src/recording.js?${Math.random()}`);
    await startRecording();
    assert.equal(streams[0].getTracks()[0].stopped, false);

    stopAllRecording();

    assert.equal(streams[0].getTracks()[0].stopped, true, "the card changed while she was mid-recording");
  });

  it("starting a new recording releases the previous one, even if it was abandoned", async () => {
    const { startRecording } = await import(`../src/recording.js?${Math.random()}`);
    await startRecording();
    await startRecording(); // a second tap nobody guarded against, or a genuinely new recording

    assert.equal(streams[0].getTracks()[0].stopped, true, "the first stream was never released");
    assert.equal(streams[1].getTracks()[0].stopped, false, "the second is still the live one");
  });

  it("a recorder that dies on its own still releases its tracks", async () => {
    const { startRecording } = await import(`../src/recording.js?${Math.random()}`);
    await startRecording();
    recorders[0].dieWithoutStopping();

    assert.equal(streams[0].getTracks()[0].stopped, true);
  });

  it("stop() still resolves and releases normally", async () => {
    const { startRecording } = await import(`../src/recording.js?${Math.random()}`);
    const controller = await startRecording();
    recorders[0].mimeType = "audio/webm";
    await controller.stop();

    assert.equal(streams[0].getTracks()[0].stopped, true);
  });
});
