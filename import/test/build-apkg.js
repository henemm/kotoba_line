import { crc32, deflateRawSync, zstdCompressSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "../../server/node_modules/better-sqlite3/lib/index.js";

/**
 * Build a small but genuine `.apkg` in memory, so the reader is tested against
 * the real format rather than a mock — and so CI never downloads 110 MB.
 */

const STORED = 0;
const DEFLATE = 8;

/** members: [{ name, data, method }] */
export function buildZip(members) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data, method = STORED } of members) {
    const nameBuf = Buffer.from(name, "utf8");
    const body = method === DEFLATE ? deflateRawSync(data) : data;
    const crc = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10); // time
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const cdir = Buffer.alloc(46);
    cdir.writeUInt32LE(0x02014b50, 0);
    cdir.writeUInt16LE(20, 4);
    cdir.writeUInt16LE(20, 6);
    cdir.writeUInt16LE(0, 8);
    cdir.writeUInt16LE(method, 10);
    cdir.writeUInt32LE(0, 12);
    cdir.writeUInt32LE(crc, 16);
    cdir.writeUInt32LE(body.length, 20);
    cdir.writeUInt32LE(data.length, 24);
    cdir.writeUInt16LE(nameBuf.length, 28);
    cdir.writeUInt32LE(0, 30); // extra + comment lengths
    cdir.writeUInt32LE(0, 34); // disk + internal attrs
    cdir.writeUInt32LE(0, 38); // external attrs
    cdir.writeUInt32LE(offset, 42);
    central.push(cdir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** Encode one protobuf length-delimited field. */
function lenField(fieldNo, payload) {
  return Buffer.concat([varint(fieldNo * 8 + 2), varint(payload.length), payload]);
}

function varintField(fieldNo, value) {
  return Buffer.concat([varint(fieldNo * 8 + 0), varint(value)]);
}

function varint(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return Buffer.from(out);
}

/** The MediaEntries message Anki writes. */
export function buildMediaIndex(entries) {
  return Buffer.concat(
    entries.map((e) =>
      lenField(
        1,
        Buffer.concat([
          lenField(1, Buffer.from(e.name, "utf8")),
          varintField(2, e.size),
        ]),
      ),
    ),
  );
}

/** A collection database with the tables and columns the importer reads. */
export function buildCollection(notes) {
  const dir = mkdtempSync(join(tmpdir(), "kotoba-test-col-"));
  const path = join(dir, "collection.sqlite");
  const db = new Database(path);

  db.exec(`
    CREATE TABLE notetypes (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT, tags TEXT);
  `);

  const ntid = 1708628080880;
  db.prepare("INSERT INTO notetypes (id, name) VALUES (?, ?)").run(ntid, "Kaishi 1.5k");

  const fieldNames = [
    "Word", "Word Reading", "Word Meaning", "Word Furigana", "Word Audio",
    "Sentence", "Sentence Meaning", "Sentence Furigana", "Sentence Audio",
    "Notes", "Pitch Accent", "Pitch Accent Notes", "Frequency", "Picture",
  ];
  const insertField = db.prepare("INSERT INTO fields (ntid, ord, name) VALUES (?, ?, ?)");
  fieldNames.forEach((name, ord) => insertField.run(ntid, ord, name));

  // A second notetype with the wrong shape, so the importer has to pick.
  db.prepare("INSERT INTO notetypes (id, name) VALUES (?, ?)").run(999, "Basic");
  insertField.run(999, 0, "Front");
  insertField.run(999, 1, "Back");

  const insertNote = db.prepare("INSERT INTO notes (id, mid, flds, tags) VALUES (?, ?, ?, ?)");
  for (const note of notes) {
    const flds = fieldNames.map((n) => note[n] ?? "").join("\x1f");
    insertNote.run(note.id, ntid, flds, "");
  }
  insertNote.run(500, 999, ["irrelevant", "note"].join("\x1f"), "");

  db.close();
  const bytes = readFileSync(path);
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

/**
 * A complete .apkg: zstd-compressed collection, protobuf media index, and
 * individually zstd-compressed media files — the three things §8 gets wrong.
 */
export function buildApkg({ notes, media = [] }) {
  const members = [
    { name: "meta", data: Buffer.from([0x08, 0x03]) },
    { name: "collection.anki21b", data: zstdCompressSync(buildCollection(notes)) },
    {
      name: "media",
      data: zstdCompressSync(
        buildMediaIndex(media.map((m) => ({ name: m.name, size: m.data.length }))),
      ),
    },
  ];
  media.forEach((m, i) => {
    members.push({ name: String(i), data: zstdCompressSync(m.data) });
  });
  return buildZip(members);
}

/** Bytes that pass the importer's "is this really an MP3" check. */
export function fakeMp3(seed = "a") {
  return Buffer.concat([
    Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00", "latin1"),
    Buffer.from(seed.repeat(64), "latin1"),
  ]);
}

export { STORED, DEFLATE };
