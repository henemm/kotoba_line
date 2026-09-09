import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { parseMediaEntries } from "./protobuf.js";
import { readCentralDirectory, readEntry } from "./zip.js";

/**
 * Open an Anki `.apkg` and expose its collection and media.
 *
 * Three things differ from §8 of the spec, all verified against the current
 * Kaishi release. They are written down here because each one costs an
 * afternoon to rediscover:
 *
 *  1. The media index is protobuf, not JSON (see ./protobuf.js).
 *  2. Every media file is *individually* zstd-compressed. Copying the numbered
 *     members straight out gives you thousands of unplayable files.
 *  3. No external zstd tool or dependency is needed. Node has had zstd in
 *     node:zlib since 22.15; the spec treats decompression as the hard part
 *     and it is now one call.
 */

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

const isZstd = (buf) =>
  buf.length >= 4 && ZSTD_MAGIC.every((b, i) => buf[i] === b);

/** Decompress if it is zstd, pass through if it is not. */
function maybeUnzstd(buf) {
  return isZstd(buf) ? zstdDecompressSync(buf) : buf;
}

export function openApkg(path) {
  const archive = readFileSync(path);
  const members = readCentralDirectory(archive);

  // collection.anki21b is the v3 (zstd) collection; collection.anki2 is the
  // uncompressed stub older Anki versions read. Prefer the newer one and fall
  // back, so an older export still imports.
  const collectionName = members.has("collection.anki21b")
    ? "collection.anki21b"
    : members.has("collection.anki2")
      ? "collection.anki2"
      : undefined;
  if (!collectionName) {
    throw new Error("no collection found in the archive — is this an .apkg?");
  }

  const collection = maybeUnzstd(readEntry(archive, members.get(collectionName)));
  if (collection.subarray(0, 15).toString("latin1") !== "SQLite format 3") {
    throw new Error(`${collectionName} did not decompress to a SQLite database`);
  }

  const mediaMember = members.get("media");
  const mediaEntries = mediaMember
    ? parseMediaEntries(maybeUnzstd(readEntry(archive, mediaMember)))
    : [];

  /** Read media file `index` — the zip member named after its position. */
  function readMedia(index) {
    const member = members.get(String(index));
    if (!member) throw new Error(`media file ${index} is missing from the archive`);
    return maybeUnzstd(readEntry(archive, member));
  }

  /** name → index, for looking media up by the filename a note refers to. */
  const mediaIndexByName = new Map(mediaEntries.map((e, i) => [e.name, i]));

  return {
    collectionName,
    collection,
    mediaEntries,
    mediaIndexByName,
    readMedia,
    readMediaByName(name) {
      const index = mediaIndexByName.get(name);
      return index === undefined ? undefined : readMedia(index);
    },
  };
}
