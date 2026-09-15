#!/usr/bin/env node
/**
 * Write the hiragana and katakana decks into the app's database (#158), and
 * the stroke-order drawings for them into the media directory.
 *
 *   npm run import-kana
 *   npm run import-kana -- --db /srv/kotoba/data/kotoba.sqlite --media /srv/kotoba/media
 *   npm run import-kana -- --no-strokes      # the cards only, no network
 *
 * Re-runnable. A card's id comes from its characters (lib/kana.js), so a
 * second run finds the same rows, and only a row whose content changed gets a
 * new `updated_at` — the phones are not sent 208 unchanged cards again.
 *
 * The drawings are KanjiVG's (CC BY-SA 3.0, https://kanjivg.tagaini.net),
 * copied unchanged with their copyright header, from one pinned release so a
 * re-run cannot quietly pick up a different drawing. A file already on disk is
 * left alone. Run under `umask 022`, as the Kaishi import: nginx reads these.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../server/src/db.js";
import { kanaCards, strokeCharacters, strokeFile } from "./lib/kana.js";

export const KANJIVG_RELEASE = "r20250816";

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
export function writeKanaCards(db, now = Math.floor(Date.now() / 1000)) {
  const existing = db.prepare("SELECT word, word_reading, word_meaning, frequency_rank, deck, deleted_at FROM cards WHERE id = ?");
  const upsert = db.prepare(
    `INSERT INTO cards (id, word, word_reading, word_meaning, frequency_rank, deck, updated_at)
     VALUES (@id, @word, @word_reading, @word_meaning, @frequency_rank, @deck, @updated_at)
     ON CONFLICT (id) DO UPDATE SET
       word = excluded.word,
       word_reading = excluded.word_reading,
       word_meaning = excluded.word_meaning,
       frequency_rank = excluded.frequency_rank,
       deck = excluded.deck,
       deleted_at = NULL,
       updated_at = excluded.updated_at`,
  );
  let changed = 0;
  db.transaction(() => {
    for (const card of kanaCards()) {
      const row = existing.get(card.id);
      const same =
        row &&
        row.deleted_at == null &&
        ["word", "word_reading", "word_meaning", "frequency_rank", "deck"].every((k) => row[k] === card[k]);
      if (same) continue;
      upsert.run({ ...card, updated_at: now });
      changed += 1;
    }
  })();
  return changed;
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
  const changed = writeKanaCards(db);
  db.close();
  process.stdout.write(`Kana cards: ${total} in ${dbFile}, ${changed} new or changed\n`);

  if (args["no-strokes"]) {
    process.stdout.write("Stroke order skipped (--no-strokes)\n");
  } else {
    const { written, kept } = await writeStrokes(mediaDir);
    process.stdout.write(`Stroke order (KanjiVG ${KANJIVG_RELEASE}): ${written} written, ${kept} already there, in ${mediaDir}\n`);
  }
}
