/**
 * Just enough protobuf to read Anki's media index.
 *
 * §8 of the spec describes that index as JSON. It is not, and has not been
 * since Anki moved to the v3 export format: it is a zstd-compressed protobuf
 * message. The schema is small enough to read without a library or a .proto
 * file:
 *
 *   message MediaEntries {
 *     message MediaEntry {
 *       string name = 1;
 *       uint32 size = 2;
 *       bytes  sha1 = 3;
 *     }
 *     repeated MediaEntry entries = 1;
 *   }
 */

const WIRE_VARINT = 0;
const WIRE_I64 = 1;
const WIRE_LEN = 2;
const WIRE_I32 = 5;

/** Yield [fieldNumber, value] for each field in a message. */
export function* readFields(buf) {
  let p = 0;
  while (p < buf.length) {
    const [key, afterKey] = readVarint(buf, p);
    p = afterKey;
    const field = Math.floor(key / 8);
    const wire = key % 8;

    if (wire === WIRE_LEN) {
      const [len, afterLen] = readVarint(buf, p);
      p = afterLen;
      yield [field, buf.subarray(p, p + len)];
      p += len;
    } else if (wire === WIRE_VARINT) {
      const [value, after] = readVarint(buf, p);
      p = after;
      yield [field, value];
    } else if (wire === WIRE_I64) {
      yield [field, buf.readBigUInt64LE(p)];
      p += 8;
    } else if (wire === WIRE_I32) {
      yield [field, buf.readUInt32LE(p)];
      p += 4;
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
  }
}

/**
 * Multiply rather than shift: `<<` in JavaScript is a 32-bit operation, so a
 * varint past 2^31 would silently wrap.
 */
function readVarint(buf, start) {
  let value = 0;
  let scale = 1;
  let p = start;
  let byte;
  do {
    if (p >= buf.length) throw new Error("truncated varint");
    byte = buf[p++];
    value += (byte & 0x7f) * scale;
    scale *= 128;
  } while (byte & 0x80);
  return [value, p];
}

/**
 * Media index → an array positionally aligned with the numbered zip members:
 * entry i in this list is the file stored in the archive under the name "i".
 */
export function parseMediaEntries(buf) {
  const entries = [];
  for (const [field, value] of readFields(buf)) {
    if (field !== 1) continue;
    const entry = { name: undefined, size: undefined };
    for (const [f, v] of readFields(value)) {
      if (f === 1) entry.name = v.toString("utf8");
      else if (f === 2) entry.size = v;
    }
    if (entry.name === undefined) throw new Error("media entry without a name");
    entries.push(entry);
  }
  return entries;
}
