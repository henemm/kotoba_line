import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TARGET_LEVEL, activeLevel, gainSteps, parseWav } from "../lib/wav-level.js";

/** A minimal mono 16-bit PCM WAV, built rather than fixture-loaded so the test states its own input. */
function wav(samples, sampleRate = 24000) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(s), i * 2));
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // mono
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * 2, 8); // byte rate
  fmt.writeUInt16LE(2, 12); // block align
  fmt.writeUInt16LE(16, 14); // bits
  const chunk = (id, body) => Buffer.concat([Buffer.from(id, "latin1"), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(body.length); return b; })(), body]);
  const fmtChunk = chunk("fmt ", fmt);
  const dataChunk = chunk("data", data);
  const riffBody = Buffer.concat([Buffer.from("WAVE", "latin1"), fmtChunk, dataChunk]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(riffBody.length);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), riffSize, riffBody]);
}

describe("wav-level (#183)", () => {
  it("reads sample rate and PCM samples back as -1..1 floats", () => {
    const { sampleRate, samples } = parseWav(wav([0, 16384, -32768, 32767], 24000));
    assert.equal(sampleRate, 24000);
    assert.equal(samples.length, 4);
    assert.equal(samples[0], 0);
    assert.ok(Math.abs(samples[1] - 0.5) < 1e-4);
    assert.equal(samples[2], -1);
  });

  it("rejects anything that is not a RIFF/WAVE file", () => {
    assert.throws(() => parseWav(Buffer.from("not a wav")), /RIFF\/WAVE/);
  });

  it("ignores near-silence: a loud tone with a long quiet tail measures close to the tone alone", () => {
    const sampleRate = 24000;
    const tone = Array.from({ length: sampleRate }, (_, i) => 10000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    const quiet = Array.from({ length: sampleRate }, () => 5); // far more than 30 dB below the tone
    const loud = activeLevel(parseWav(wav(tone, sampleRate)));
    const withTail = activeLevel(parseWav(wav([...tone, ...quiet], sampleRate)));
    assert.ok(Math.abs(loud - withTail) < 1e-4, `${loud} vs ${withTail}`);
  });

  it("gainSteps brings a measured level to the target, in 1.5 dB steps", () => {
    assert.equal(gainSteps(TARGET_LEVEL), 0);
    // Half the target is -6 dB, four steps of 1.5 dB.
    assert.equal(gainSteps(TARGET_LEVEL / 2 ** 1), 4);
  });
});
