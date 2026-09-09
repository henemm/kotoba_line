import { crc32, inflateRawSync } from "node:zlib";

/**
 * A minimal zip reader — enough for an `.apkg` and no more.
 *
 * Node has no built-in zip, and the brief asks before adding dependencies the
 * spec does not name. An `.apkg` is a plain zip whose members are already
 * compressed (zstd), so they are almost all STORED; a hundred lines here beats
 * a dependency, and it fails loudly on anything it does not handle rather than
 * guessing.
 */

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

/**
 * Parse the central directory into a Map of name → entry.
 *
 * The central directory is authoritative: a local header may carry zeroed
 * sizes with a trailing data descriptor, so sizes are read from here.
 */
export function readCentralDirectory(buf) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - EOCD_MIN - MAX_COMMENT);
  for (let i = buf.length - EOCD_MIN; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file: no end-of-central-directory record");

  const count = buf.readUInt16LE(eocd + 10);
  const offset = buf.readUInt32LE(eocd + 16);

  // 0xffff / 0xffffffff are the zip64 escape values. A Kaishi export is ~110 MB
  // with ~4,400 members, nowhere near either limit — so refuse rather than
  // silently misread an archive that has outgrown this reader.
  if (count === 0xffff || offset === 0xffffffff) {
    throw new Error("zip64 archives are not supported by this reader");
  }

  const entries = new Map();
  let p = offset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CDIR_SIG) {
      throw new Error(`corrupt central directory: bad signature at byte ${p}`);
    }
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    entries.set(name, { name, method, crc, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Read one member's bytes. STORED and DEFLATE only.
 *
 * The stored CRC is checked. It costs nothing next to the decompression and it
 * catches a truncated download — the failure that would otherwise surface as a
 * confusing SQLite or zstd error several steps later.
 */
export function readEntry(buf, entry) {
  const p = entry.localOffset;
  if (buf.readUInt32LE(p) !== LOCAL_SIG) {
    throw new Error(`corrupt local header for ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);

  let data;
  if (entry.method === 0) data = raw;
  else if (entry.method === 8) data = inflateRawSync(raw);
  else throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);

  const actual = crc32(data) >>> 0;
  if (actual !== entry.crc) {
    throw new Error(
      `${entry.name} failed its checksum — the archive is truncated or corrupt`,
    );
  }
  return data;
}
