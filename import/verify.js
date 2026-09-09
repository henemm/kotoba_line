#!/usr/bin/env node
/**
 * Verify a sample of imported cards renders correctly, audio included (§8,
 * and the brief's phase 3: "verify a random sample of twenty cards").
 *
 *   npm run verify-import
 *   npm run verify-import -- --sample 20 --db ./data/kotoba.sqlite --media ./media
 *
 * Exits non-zero if any check fails, so it can run in CI once a deck exists.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "../server/node_modules/better-sqlite3/lib/index.js";

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

/**
 * An MP3 either opens with an ID3 tag or with a frame sync (0xFF Ex).
 * Checking the bytes catches the failure mode that matters here: a media file
 * copied out of the archive without being zstd-decompressed looks like a file
 * of the right name and the wrong content.
 */
function looksLikeMp3(buf) {
  if (buf.length < 4) return false;
  if (buf.subarray(0, 3).toString("latin1") === "ID3") return true;
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

const args = parseArgs(process.argv.slice(2));
const dataDir = args["data-dir"] ?? process.env.DATA_DIR ?? "./data";
const dbFile = args.db ?? join(dataDir, "kotoba.sqlite");
const mediaDir = args.media ?? process.env.MEDIA_DIR ?? "./media";
const sampleSize = Number.parseInt(args.sample ?? "20", 10);

if (!existsSync(dbFile)) {
  console.error(`No database at ${dbFile}. Run the import first.`);
  process.exit(2);
}

const db = new Database(dbFile, { readonly: true });

const total = db.prepare("SELECT count(*) n FROM cards").get().n;
if (total === 0) {
  console.error("The cards table is empty. Run the import first.");
  process.exit(2);
}

const withWordAudio = db.prepare("SELECT count(*) n FROM cards WHERE word_audio IS NOT NULL").get().n;
const withSentence = db.prepare("SELECT count(*) n FROM cards WHERE sentence IS NOT NULL").get().n;
const tagged = db.prepare("SELECT count(DISTINCT card_id) n FROM tags").get().n;

console.log(`Deck: ${total} cards`);
console.log(`  with word audio:      ${withWordAudio}`);
console.log(`  with a sentence:      ${withSentence}`);
console.log(`  carrying a tag:       ${tagged}`);
console.log("");

const sample = db
  .prepare("SELECT * FROM cards ORDER BY random() LIMIT ?")
  .all(sampleSize);

const problems = [];

for (const card of sample) {
  const issues = [];

  if (!card.word) issues.push("no word");
  if (!card.word_meaning) issues.push("no meaning");

  // Leftover Anki markup means the field mapping regressed.
  for (const [field, value] of Object.entries(card)) {
    if (typeof value !== "string") continue;
    if (value.includes("[sound:")) issues.push(`${field} still holds [sound:] markup`);
    if (/<(?!\/?b\b)[a-z][^>]*>/i.test(value)) issues.push(`${field} still holds HTML`);
    if (value.includes("\x1f")) issues.push(`${field} holds a field separator`);
  }

  for (const field of ["word_audio", "sentence_audio"]) {
    const name = card[field];
    if (!name) continue;
    const path = join(mediaDir, name);
    if (!existsSync(path)) {
      issues.push(`${field} ${name} is not on disk`);
      continue;
    }
    if (statSync(path).size === 0) {
      issues.push(`${field} ${name} is empty`);
      continue;
    }
    if (!looksLikeMp3(readFileSync(path))) {
      issues.push(`${field} ${name} is not an MP3 — was it zstd-decompressed?`);
    }
  }

  const mark = issues.length ? "FAIL" : "ok  ";
  const audio = card.word_audio ? "♪" : " ";
  console.log(
    `${mark} ${audio} ${String(card.frequency_rank ?? "-").padStart(5)}  ` +
      `${(card.word ?? "").padEnd(8)} ${(card.word_meaning ?? "").slice(0, 44)}`,
  );
  for (const issue of issues) console.log(`        ${issue}`);
  if (issues.length) problems.push({ card: card.id, issues });
}

console.log("");
if (problems.length) {
  console.error(`${problems.length} of ${sample.length} sampled cards have problems.`);
  process.exit(1);
}
console.log(`All ${sample.length} sampled cards look right, audio included.`);
