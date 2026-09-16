/**
 * How loud a WAV file is, by the same measure `kana-sounds.js` used for the
 * Commons recordings (there, decoded in a browser's Web Audio; here, straight
 * off the PCM VOICEVOX returns): the RMS of the 20 ms frames within 30 dB of
 * the loudest one, which ignores whatever silence sits between repetitions.
 *
 * The target, 0.112, is the same one — the median of that measure over every
 * 25th Kaishi word recording — so a generated clip sits at the same loudness
 * as the recordings on the same card, not a machine-voice outlier.
 */

export const TARGET_LEVEL = 0.112;

/** A mono or interleaved 16-bit PCM WAV: its sample rate and one Int16Array per channel, averaged to mono. */
export function parseWav(buf) {
  if (buf.length < 12 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let pos = 12;
  let fmt, data;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("latin1", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      fmt = { channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    }
    if (id === "data") data = { offset: body, length: size };
    pos = body + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error("WAV has no fmt or data chunk");
  if (fmt.bits !== 16) throw new Error(`unsupported WAV bit depth ${fmt.bits}`);
  const frameCount = data.length / 2 / fmt.channels;
  const samples = new Float32Array(frameCount);
  for (let i = 0, o = data.offset; i < frameCount; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++, o += 2) sum += buf.readInt16LE(o) / 32768;
    samples[i] = sum / fmt.channels;
  }
  return { sampleRate: fmt.sampleRate, samples };
}

/** The active level: RMS of 20 ms frames within 30 dB of the loudest, empty audio aside. */
export function activeLevel({ sampleRate, samples }) {
  const frameSize = Math.round(sampleRate * 0.02);
  const frames = [];
  for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
    let sumSq = 0;
    for (let j = 0; j < frameSize; j++) sumSq += samples[i + j] * samples[i + j];
    frames.push(Math.sqrt(sumSq / frameSize));
  }
  const loudest = Math.max(0, ...frames);
  if (loudest === 0) return 0;
  const threshold = loudest / 10 ** (30 / 20);
  const active = frames.filter((f) => f >= threshold);
  return Math.sqrt(active.reduce((s, f) => s + f * f, 0) / active.length);
}

/** Steps of 1.5 dB (mp3gain.js's unit) to bring `level` to `TARGET_LEVEL`. */
export function gainSteps(level) {
  return Math.round((20 * Math.log10(TARGET_LEVEL / level)) / 1.5);
}
