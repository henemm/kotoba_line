#!/usr/bin/env node
/**
 * Import the Kaishi 1.5k deck into the app's database (§8).
 *
 *   npm run import                        # download the latest release, import
 *   npm run import -- --apkg ./Kaishi.apkg
 *   npm run import -- --db /srv/kotoba/data/kotoba.sqlite --media /srv/kotoba/media
 *
 * Re-runnable: cards are keyed on Anki's note id, so re-importing an updated
 * deck updates rows in place and every review_events row keeps pointing at the
 * card it was recorded against.
 *
 * This writes no tags. Kaishi ships without them — verified, 0 of 1501 notes
 * carry one — and §5a depends on them, so tagging is a separate pass over the
 * imported rows. See ./tag-cards.js.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "../server/node_modules/better-sqlite3/lib/index.js";
import { openDatabase } from "../server/src/db.js";
import { openApkg } from "./lib/apkg.js";
import { noteToCard } from "./lib/fields.js";

const DECK_URL =
  "https://github.com/donkuri/Kaishi/releases/latest/download/Kaishi.1.5k.apkg";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

async function download(url, dest) {
  process.stdout.write(`Downloading ${url}\n`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  process.stdout.write(`  ${(buf.length / 1e6).toFixed(1)} MB → ${dest}\n`);
  return dest;
}

/**
 * Find the vocabulary notetype by the fields it has rather than by its name,
 * so a renamed or forked deck still imports. Returns name → ordinal.
 */
function findNotetype(col) {
  const byNotetype = new Map();
  for (const row of col.prepare("SELECT ntid, ord, name FROM fields").all()) {
    if (!byNotetype.has(row.ntid)) byNotetype.set(row.ntid, new Map());
    byNotetype.get(row.ntid).set(row.name, row.ord);
  }

  const required = ["Word", "Word Meaning", "Word Audio", "Sentence"];
  for (const [ntid, fields] of byNotetype) {
    if (required.every((f) => fields.has(f))) {
      const { name } = col.prepare("SELECT name FROM notetypes WHERE id = ?").get(ntid);
      return { ntid, name, fields };
    }
  }
  throw new Error(
    `no notetype carries all of ${required.join(", ")} — this does not look like Kaishi`,
  );
}

const args = parseArgs(process.argv.slice(2));

const dataDir = args["data-dir"] ?? process.env.DATA_DIR ?? "./data";
const dbFile = args.db ?? join(dataDir, "kotoba.sqlite");
const mediaDir = args.media ?? process.env.MEDIA_DIR ?? "./media";
const deckName = args.deck ?? "kaishi";
const limit = args.limit ? Number.parseInt(args.limit, 10) : undefined;

const work = mkdtempSync(join(tmpdir(), "kotoba-import-"));

let apkgPath = args.apkg;
if (!apkgPath) {
  apkgPath = await download(DECK_URL, join(work, "Kaishi.apkg"));
} else if (!existsSync(apkgPath)) {
  throw new Error(`no such file: ${apkgPath}`);
}

process.stdout.write(`Reading ${apkgPath} (${(statSync(apkgPath).size / 1e6).toFixed(1)} MB)\n`);
const pkg = openApkg(apkgPath);
process.stdout.write(
  `  collection: ${pkg.collectionName}, media index: ${pkg.mediaEntries.length} files\n`,
);

// better-sqlite3 opens a path, so the decompressed collection goes to a
// scratch file that is thrown away with the temp directory.
const collectionPath = join(work, "collection.sqlite");
writeFileSync(collectionPath, pkg.collection);
const col = new Database(collectionPath, { readonly: true });

const notetype = findNotetype(col);
process.stdout.write(`  notetype: ${notetype.name} (${notetype.fields.size} fields)\n`);

let notes = col
  .prepare("SELECT id, flds FROM notes WHERE mid = ? ORDER BY id")
  .all(notetype.ntid);
if (limit) notes = notes.slice(0, limit);

const cards = [];
let skipped = 0;
for (const note of notes) {
  const card = noteToCard(note.id, note.flds, notetype.fields, deckName);
  if (card) cards.push(card);
  else skipped += 1;
}
col.close();

process.stdout.write(`  notes: ${notes.length}, importable: ${cards.length}, skipped: ${skipped}\n`);

// ── write cards ──────────────────────────────────────────────────────
const db = openDatabase(dbFile);

const upsert = db.prepare(
  `INSERT INTO cards
     (id, word, word_furigana, word_reading, word_meaning, word_audio,
      sentence, sentence_furigana, sentence_meaning, sentence_audio,
      frequency_rank, deck, updated_at)
   VALUES
     (@id, @word, @word_furigana, @word_reading, @word_meaning, @word_audio,
      @sentence, @sentence_furigana, @sentence_meaning, @sentence_audio,
      @frequency_rank, @deck, @updated_at)
   ON CONFLICT (id) DO UPDATE SET
     word = excluded.word,
     word_furigana = excluded.word_furigana,
     word_reading = excluded.word_reading,
     word_meaning = excluded.word_meaning,
     word_audio = excluded.word_audio,
     sentence = excluded.sentence,
     sentence_furigana = excluded.sentence_furigana,
     sentence_meaning = excluded.sentence_meaning,
     sentence_audio = excluded.sentence_audio,
     frequency_rank = excluded.frequency_rank,
     deck = excluded.deck,
     updated_at = excluded.updated_at`,
);

// §5: the client fetches `/api/deck?since=` and needs to know what moved.
const importedAt = Math.floor(Date.now() / 1000);
db.transaction(() => {
  for (const card of cards) upsert.run({ ...card, updated_at: importedAt });
})();

process.stdout.write(`Wrote ${cards.length} cards to ${dbFile}\n`);

// ── write media ──────────────────────────────────────────────────────
// Only what a card refers to. The archive also carries illustrations for the
// deck's Picture field, which our schema has no column for and the designs do
// not show — copying them would be ~40 MB nothing ever asks for.
mkdirSync(mediaDir, { recursive: true });

const wanted = new Set();
for (const c of cards) {
  if (c.word_audio) wanted.add(c.word_audio);
  if (c.sentence_audio) wanted.add(c.sentence_audio);
}

let written = 0;
let missing = 0;
let bytes = 0;
for (const name of wanted) {
  const data = pkg.readMediaByName(name);
  if (!data) {
    missing += 1;
    process.stderr.write(`  ! referenced but not in the archive: ${name}\n`);
    continue;
  }
  writeFileSync(join(mediaDir, name), data);
  written += 1;
  bytes += data.length;
}

process.stdout.write(
  `Wrote ${written} audio files (${(bytes / 1e6).toFixed(1)} MB) to ${mediaDir}\n`,
);
if (missing) process.stdout.write(`  ${missing} referenced files were missing\n`);
process.stdout.write(
  `Skipped ${pkg.mediaEntries.length - written} unreferenced media files (images, unused audio)\n`,
);

const noAudio = cards.filter((c) => !c.word_audio && !c.sentence_audio).length;
if (noAudio) {
  process.stdout.write(`${noAudio} cards have no audio at all — speech synthesis covers those\n`);
}

process.stdout.write("\nNo tags were written. Run tag-cards.js next; §5a depends on them.\n");
db.close();
