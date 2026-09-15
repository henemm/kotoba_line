/**
 * Make an MP3 louder or quieter without decoding it (#158).
 *
 * mp3gain's lossless method: every granule of every MPEG-1 Layer III frame
 * carries an 8-bit `global_gain`, the decoder scales that granule by
 * 2^((global_gain − 210) / 4), so adding the same integer to all of them
 * changes the level by 1.5 dB a step and touches nothing else — no re-encode,
 * no new generation of artefacts, and no dependency (import/ has none of its
 * own).
 *
 * Only what the kana recordings are: MPEG-1 Layer III without CRC. Anything
 * else throws instead of being guessed at, because a wrong bit offset does
 * not fail — it writes noise into the file and still plays.
 */

const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const SAMPLE_RATES = [44100, 48000, 32000];

/** Where the audio starts: after an ID3v2 tag, if there is one. */
function audioStart(buf) {
  if (buf.length < 10 || buf.toString("latin1", 0, 3) !== "ID3") return 0;
  // The tag's size is four 7-bit bytes ("syncsafe"), not counting its header.
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const footer = buf[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

/**
 * Every frame: its offset and length, how many channels, and where each
 * granule's `global_gain` and `part2_3_length` sit, as bit positions from the
 * start of the side information.
 *
 * The side information follows the 4-byte header: 32 bytes for two channels,
 * 17 for one. It opens with main_data_begin (9 bits), private_bits (3 for two
 * channels, 5 for one) and scfsi (4 per channel), then one 59-bit block per
 * granule and channel — gr0 ch0, gr0 ch1, gr1 ch0, gr1 ch1 — in which
 * part2_3_length is the first 12 bits and global_gain starts at bit 21.
 */
export function mp3Frames(buf) {
  const frames = [];
  let pos = audioStart(buf);
  while (pos + 4 <= buf.length) {
    // An ID3v1 tag at the end is not audio.
    if (buf.toString("latin1", pos, pos + 3) === "TAG" && buf.length - pos === 128) break;
    if (buf[pos] !== 0xff || (buf[pos + 1] & 0xe0) !== 0xe0) {
      throw new Error(`no MPEG frame at byte ${pos}`);
    }
    const version = (buf[pos + 1] >> 3) & 0b11;
    const layer = (buf[pos + 1] >> 1) & 0b11;
    const noCrc = buf[pos + 1] & 1;
    if (version !== 0b11 || layer !== 0b01) throw new Error(`frame at byte ${pos} is not MPEG-1 Layer III`);
    if (!noCrc) throw new Error(`frame at byte ${pos} has a CRC, which a gain change would break`);
    const bitrate = BITRATES[buf[pos + 2] >> 4];
    const sampleRate = SAMPLE_RATES[(buf[pos + 2] >> 2) & 0b11];
    if (!bitrate || !sampleRate) throw new Error(`frame at byte ${pos} has no usable bitrate or sample rate`);
    const padding = (buf[pos + 2] >> 1) & 1;
    const channels = ((buf[pos + 3] >> 6) & 0b11) === 0b11 ? 1 : 2;
    const length = Math.floor((144000 * bitrate) / sampleRate) + padding;
    if (pos + length > buf.length) throw new Error(`frame at byte ${pos} runs past the end of the file`);

    const sideInfo = pos + 4;
    const sideLength = channels === 2 ? 32 : 17;
    const lead = channels === 2 ? 9 + 3 + 8 : 9 + 5 + 4;
    const granules = [];
    for (let i = 0; i < 2 * channels; i++) {
      const block = lead + i * 59;
      granules.push({ part23: block, gain: block + 21 });
    }
    // A Xing or Info frame is a silent frame holding the file's table of
    // contents where the audio would be. mp3gain leaves it alone; so does this.
    const tag = buf.toString("latin1", sideInfo + sideLength, sideInfo + sideLength + 4);
    frames.push({ offset: pos, length, channels, sideInfo, granules, info: tag === "Xing" || tag === "Info" });
    pos += length;
  }
  if (frames.length === 0) throw new Error("no MPEG frames");
  return frames;
}

function readBits(buf, byteOffset, bit, count) {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const at = bit + i;
    value = (value << 1) | ((buf[byteOffset + (at >> 3)] >> (7 - (at & 7))) & 1);
  }
  return value;
}

function writeBits(buf, byteOffset, bit, count, value) {
  for (let i = 0; i < count; i++) {
    const at = bit + i;
    const byte = byteOffset + (at >> 3);
    const mask = 1 << (7 - (at & 7));
    if ((value >> (count - 1 - i)) & 1) buf[byte] |= mask;
    else buf[byte] &= ~mask;
  }
}

/**
 * The `global_gain` of every granule that holds sound. A granule whose
 * part2_3_length is 0 has no scalefactors and no coefficients — digital
 * silence — and its gain means nothing, so it is left out here and left alone
 * by `withGain`.
 */
export function globalGains(buf) {
  const gains = [];
  for (const frame of mp3Frames(buf)) {
    if (frame.info) continue;
    for (const g of frame.granules) {
      if (readBits(buf, frame.sideInfo, g.part23, 12) === 0) continue;
      gains.push(readBits(buf, frame.sideInfo, g.gain, 8));
    }
  }
  return gains;
}

/**
 * A copy of `buf` with `steps` (×1.5 dB) added to every granule's
 * `global_gain`. Throws rather than clamp at 0 or 255: clamping some granules
 * and not others would change the balance inside the recording, which is
 * worse than the difference between recordings it was meant to fix.
 */
export function withGain(buf, steps) {
  if (!Number.isInteger(steps)) throw new Error(`gain steps must be an integer, not ${steps}`);
  const out = Buffer.from(buf);
  if (steps === 0) return out;
  for (const frame of mp3Frames(out)) {
    if (frame.info) continue;
    for (const g of frame.granules) {
      if (readBits(out, frame.sideInfo, g.part23, 12) === 0) continue;
      const gain = readBits(out, frame.sideInfo, g.gain, 8) + steps;
      if (gain < 0 || gain > 255) {
        throw new Error(`frame at byte ${frame.offset}: global_gain would be ${gain}, outside 0–255`);
      }
      writeBits(out, frame.sideInfo, g.gain, 8, gain);
    }
  }
  return out;
}
