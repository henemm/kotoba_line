import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globalGains, mp3Frames, withGain } from "../lib/mp3gain.js";

// Frames built bit by bit. What the real recordings do in a decoder is
// measured separately (Chromium and WebKit, recorded in import/lib/kana-sounds.js);
// this checks that the bits land where the standard puts them.

function setBits(buf, byteOffset, bit, count, value) {
  for (let i = 0; i < count; i++) {
    const at = bit + i;
    const mask = 1 << (7 - (at & 7));
    if ((value >> (count - 1 - i)) & 1) buf[byteOffset + (at >> 3)] |= mask;
    else buf[byteOffset + (at >> 3)] &= ~mask;
  }
}
function getBits(buf, byteOffset, bit, count) {
  let v = 0;
  for (let i = 0; i < count; i++) {
    const at = bit + i;
    v = (v << 1) | ((buf[byteOffset + (at >> 3)] >> (7 - (at & 7))) & 1);
  }
  return v;
}

/**
 * One 64 kbit/s 44.1 kHz frame (208 bytes), with the given global_gain and
 * part2_3_length per granule, and every other bit of the frame set to a
 * pattern so a stray write shows.
 */
function frame({ channels = 2, gains, part23 = gains.map(() => 100), crc = false, info = false }) {
  const buf = Buffer.alloc(208, 0xa5);
  buf[0] = 0xff;
  buf[1] = 0xfa | (crc ? 0 : 1);
  buf[2] = 0x50; // bitrate index 5 (64 kbit/s), 44.1 kHz, no padding
  buf[3] = channels === 1 ? 0xc0 : 0x40; // mono, or joint stereo
  const lead = channels === 2 ? 20 : 18;
  if (info) {
    buf.fill(0, 4, 4 + (channels === 2 ? 32 : 17));
    buf.write("Info", 4 + (channels === 2 ? 32 : 17), "latin1");
  }
  gains.forEach((g, i) => {
    setBits(buf, 4, lead + i * 59, 12, part23[i]);
    setBits(buf, 4, lead + i * 59 + 21, 8, g);
  });
  return buf;
}
const id3 = () => Buffer.concat([Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x23", "latin1"), Buffer.alloc(35)]);

describe("changing an MP3's level without decoding it (#158)", () => {
  it("finds the frames after an ID3 tag, as the Commons transcodes have one (45 bytes)", () => {
    const file = Buffer.concat([id3(), frame({ gains: [150, 151, 152, 153] }), frame({ gains: [160, 161, 162, 163] })]);
    const frames = mp3Frames(file);
    assert.deepEqual(frames.map((f) => f.offset), [45, 253]);
    assert.deepEqual(globalGains(file), [150, 151, 152, 153, 160, 161, 162, 163]);
  });

  it("adds the steps to every granule's global_gain and changes no other bit", () => {
    const file = Buffer.concat([id3(), frame({ gains: [150, 151, 152, 153] })]);
    const quieter = withGain(file, -4);
    assert.deepEqual(globalGains(quieter), [146, 147, 148, 149]);
    // Put the gains back by hand: what is left must be the original file.
    const restored = Buffer.from(quieter);
    for (let i = 0; i < 4; i++) setBits(restored, 45 + 4, 20 + i * 59 + 21, 8, getBits(file, 45 + 4, 20 + i * 59 + 21, 8));
    assert.deepEqual(restored, file);
    assert.notEqual(quieter, file, "a copy, not the buffer it was given");
  });

  it("reads a mono frame's shorter side information at its own offsets", () => {
    const file = frame({ channels: 1, gains: [140, 141] });
    assert.deepEqual(globalGains(file), [140, 141]);
    assert.deepEqual(globalGains(withGain(file, 3)), [143, 144]);
  });

  it("leaves silent granules and a Xing/Info frame alone", () => {
    const file = Buffer.concat([
      frame({ gains: [0, 0, 0, 0], info: true }),
      frame({ gains: [2, 150, 2, 150], part23: [0, 100, 0, 100] }),
    ]);
    const quieter = withGain(file, -5);
    assert.deepEqual(quieter.subarray(0, 208), file.subarray(0, 208));
    assert.equal(getBits(quieter, 208 + 4, 20 + 21, 8), 2, "silence keeps its gain, even where -5 would go below 0");
    assert.deepEqual(globalGains(quieter), [145, 145]);
  });

  it("refuses to clamp, rather than change the balance inside a recording", () => {
    assert.throws(() => withGain(frame({ gains: [3, 150, 150, 150] }), -4), /outside 0–255/);
    assert.throws(() => withGain(frame({ gains: [250, 150, 150, 150] }), 6), /outside 0–255/);
  });

  it("refuses what it does not understand instead of writing into the wrong bits", () => {
    assert.throws(() => mp3Frames(frame({ gains: [150, 150, 150, 150], crc: true })), /CRC/);
    const layer2 = frame({ gains: [150, 150, 150, 150] });
    layer2[1] = 0xfd;
    assert.throws(() => mp3Frames(layer2), /not MPEG-1 Layer III/);
    assert.throws(() => mp3Frames(Buffer.from("not an mp3 at all")), /no MPEG frame/);
    assert.throws(() => withGain(frame({ gains: [150, 150, 150, 150] }), 1.5), /integer/);
  });
});
