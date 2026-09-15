#!/usr/bin/env node
/**
 * Write the hiragana and katakana decks into the app's database (#158), and
 * the stroke-order drawings for them into the media directory.
 *
 *   npm run import-kana
 *   npm run import-kana -- --db /srv/kotoba/data/kotoba.sqlite --media /srv/kotoba/media
 *   npm run import-kana -- --no-strokes      # no stroke-order drawings
 *   npm run import-kana -- --no-examples     # keep the example words as they are
 *
 * Re-runnable. A card's id comes from its characters (lib/kana.js), so a
 * second run finds the same rows, and only a row whose content changed gets a
 * new `updated_at` — the phones are not sent 208 unchanged cards again.
 *
 * The drawings are KanjiVG's (CC BY-SA 3.0, https://kanjivg.tagaini.net),
 * copied unchanged with their copyright header, from one pinned release so a
 * re-run cannot quietly pick up a different drawing. A file already on disk is
 * left alone. Run under `umask 022`, as the Kaishi import: nginx reads these.
 *
 * Example words (v78) come from Kaishi — so run this after the Kaishi import —
 * and from the JLPT lists with JMdict's meanings, both pinned below
 * (lib/examples.js says why each).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../server/src/db.js";
import { kanaReading } from "../client/src/screens/session.js";
import { makeMeaningLookup, parseJlptCsv, pickExamples } from "./lib/examples.js";
import { kanaCards, strokeCharacters, strokeFile } from "./lib/kana.js";
import { readCentralDirectory, readEntry } from "./lib/zip.js";

export const KANJIVG_RELEASE = "r20250816";

/**
 * The JLPT lists, as CSV: tanos.co.uk's own pages send scripts an HTTP 500, so
 * this is Bluskyo's conversion of them at a fixed commit. Checked against a
 * second, independent conversion (jamsinclair/open-anki-jlpt-decks) on the
 * katakana words: N5 57 of 58 shared, N4 37 of 40 — the rest are words the two
 * file under neighbouring levels.
 */
export const JLPT_CSV =
  "https://raw.githubusercontent.com/Bluskyo/JLPT_Vocabulary/4358f932937ad0232194a36e9f4f875094910c6b/data/vocab/parsedData";

/** JMdict's common words with English glosses, as JSON, from one dated release. */
export const JMDICT_RELEASE = "3.6.2+20260914172325";
const JMDICT_ZIP = `https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(JMDICT_RELEASE)}/jmdict-eng-common-${encodeURIComponent(JMDICT_RELEASE)}.json.zip`;

/** Where the app looks for a character's drawing: flat, like the audio (see audio.js mediaUrl). */
export const strokeMediaName = (char) => `kanjivg-${strokeFile(char)}`;

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
 * Upsert the kana cards. Returns how many rows were new or changed.
 * Exported for the test, which runs it against an in-memory database.
 */
export function writeKanaCards(db, now = Math.floor(Date.now() / 1000), examples) {
  const fields = ["word", "word_reading", "word_meaning", "frequency_rank", "deck"];
  // Without `examples` (--no-examples, or a test of the cards alone) the
  // column is left as it is rather than cleared.
  if (examples) fields.push("word_examples");
  const existing = db.prepare(`SELECT ${fields.join(", ")}, deleted_at FROM cards WHERE id = ?`);
  const upsert = db.prepare(
    `INSERT INTO cards (id, ${fields.join(", ")}, updated_at)
     VALUES (@id, ${fields.map((f) => `@${f}`).join(", ")}, @updated_at)
     ON CONFLICT (id) DO UPDATE SET
       ${fields.map((f) => `${f} = excluded.${f}`).join(",\n       ")},
       deleted_at = NULL,
       updated_at = excluded.updated_at`,
  );
  let changed = 0;
  db.transaction(() => {
    for (const kanaCard of kanaCards()) {
      const found = examples?.get(kanaCard.id) ?? [];
      const card = examples ? { ...kanaCard, word_examples: found.length ? JSON.stringify(found) : null } : kanaCard;
      const row = existing.get(card.id);
      const same = row && row.deleted_at == null && fields.every((k) => row[k] === card[k]);
      if (same) continue;
      upsert.run({ ...card, updated_at: now });
      changed += 1;
    }
  })();
  return changed;
}

/** Example words for every kana card, from Kaishi in `db` and the given JLPT rows and JMdict words. */
export function kanaExamples(db, { jlpt, jmdictWords }) {
  const kaishi = db
    .prepare(
      `SELECT word, word_furigana, word_reading, word_meaning, word_audio FROM cards
        WHERE deck = 'kaishi' AND deleted_at IS NULL AND word_meaning IS NOT NULL
        ORDER BY frequency_rank IS NULL, frequency_rank, id`,
    )
    .all()
    // v83: the card's own recording travels with the word, so a word written
    // twice in Kaishi (もう, 聞く) keeps the recording of the card it came from.
    .map((c) => ({
      reading: kanaReading(c.word_furigana) ?? c.word_reading ?? c.word,
      meaning: c.word_meaning,
      audio: c.word_audio ?? undefined,
    }));
  const meaningOf = makeMeaningLookup(jmdictWords);
  return new Map(kanaCards().map((card) => [card.id, pickExamples(card, { kaishi, jlpt, meaningOf })]));
}

async function loadExampleSources() {
  const jlpt = [];
  for (const level of [5, 4, 3]) {
    const url = `${JLPT_CSV}/n${level}_vocab_cleaned.csv`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`JLPT N${level}: HTTP ${res.status} (${url})`);
    jlpt.push(...parseJlptCsv(await res.text(), level));
  }
  const res = await fetch(JMDICT_ZIP, { redirect: "follow" });
  if (!res.ok) throw new Error(`JMdict: HTTP ${res.status} (${JMDICT_ZIP})`);
  const zip = Buffer.from(await res.arrayBuffer());
  const [entry] = [...readCentralDirectory(zip).values()].filter((e) => e.name.endsWith(".json"));
  if (!entry) throw new Error("JMdict: no JSON in the release archive");
  const jmdictWords = JSON.parse(readEntry(zip, entry).toString("utf8")).words;
  return { jlpt, jmdictWords };
}

async function writeStrokes(mediaDir) {
  mkdirSync(mediaDir, { recursive: true });
  let written = 0;
  let kept = 0;
  for (const char of strokeCharacters()) {
    const dest = join(mediaDir, strokeMediaName(char));
    if (existsSync(dest)) {
      kept += 1;
      continue;
    }
    const url = `https://raw.githubusercontent.com/KanjiVG/kanjivg/${KANJIVG_RELEASE}/kanji/${strokeFile(char)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`KanjiVG has no ${char} (${url}): HTTP ${res.status}`);
    const svg = await res.text();
    if (!svg.includes("<svg")) throw new Error(`not an SVG: ${url}`);
    writeFileSync(dest, svg);
    written += 1;
  }
  return { written, kept };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = args["data-dir"] ?? process.env.DATA_DIR ?? "./data";
  const dbFile = args.db ?? join(dataDir, "kotoba.sqlite");
  const mediaDir = args.media ?? process.env.MEDIA_DIR ?? "./media";

  const db = openDatabase(dbFile);
  const total = kanaCards().length;
  let examples;
  if (args["no-examples"]) {
    process.stdout.write("Example words left as they are (--no-examples)\n");
  } else {
    const sources = await loadExampleSources();
    examples = kanaExamples(db, sources);
    for (const deck of ["hiragana", "katakana"]) {
      const cards = kanaCards().filter((c) => c.deck === deck);
      const withOne = cards.filter((c) => examples.get(c.id).length > 0).length;
      process.stdout.write(`Examples (${deck}): ${withOne} of ${cards.length} cards have one\n`);
    }
  }
  const changed = writeKanaCards(db, undefined, examples);
  db.close();
  process.stdout.write(`Kana cards: ${total} in ${dbFile}, ${changed} new or changed\n`);

  if (args["no-strokes"]) {
    process.stdout.write("Stroke order skipped (--no-strokes)\n");
  } else {
    const { written, kept } = await writeStrokes(mediaDir);
    process.stdout.write(`Stroke order (KanjiVG ${KANJIVG_RELEASE}): ${written} written, ${kept} already there, in ${mediaDir}\n`);
  }
}
