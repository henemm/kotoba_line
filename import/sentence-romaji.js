#!/usr/bin/env node
/**
 * Every example sentence's romaji into `sentence_romaji` (migration 028).
 *
 *   npm ci --prefix import/tools/sentence-romaji      # once: the tokenizer
 *   npm run sentence-romaji -- --db /srv/kotoba/data/kotoba.sqlite
 *   npm run sentence-romaji -- --db … --dry-run      # count, write nothing
 *
 * lib/sentence-romaji.js says how a sentence becomes romaji and why the
 * readings are the deck's and only the word boundaries the tokenizer's.
 *
 * Reads every live card with a sentence and furigana — Kaishi's, and her own
 * that took a Kaishi sentence (v70). The table is keyed by the sentence, so a
 * sentence two cards share is one row. Rebuilt whole on every run.
 *
 * A card whose sentence gained or changed its romaji gets a new `updated_at`,
 * which is how the phones' copy of the deck learns about it.
 */
import { createRequire } from "node:module";
import { openDatabase } from "../server/src/db.js";
import { sentenceRomaji } from "./lib/sentence-romaji.js";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : [],
  ),
);
if (!args.db) {
  process.stderr.write("--db is required (see the comment at the top of this file)\n");
  process.exit(2);
}

const toolDir = new URL("./tools/sentence-romaji/", import.meta.url);
let kuromoji;
try {
  kuromoji = createRequire(toolDir)("kuromoji");
} catch {
  process.stderr.write("kuromoji is not installed: npm ci --prefix import/tools/sentence-romaji\n");
  process.exit(2);
}
const dicPath = new URL("node_modules/kuromoji/dict/", toolDir).pathname;
const tokenizer = await new Promise((resolve, reject) =>
  kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t))),
);

const db = openDatabase(args.db);
const cards = db
  .prepare(
    `SELECT id, sentence, sentence_furigana FROM cards
      WHERE deleted_at IS NULL AND sentence IS NOT NULL AND sentence_furigana IS NOT NULL`,
  )
  .all();

const romaji = new Map();
const failed = new Map();
for (const c of cards) {
  if (romaji.has(c.sentence) || failed.has(c.sentence)) continue;
  const plain = c.sentence.replace(/<\/?b>/gi, "").replace(/\s/g, "");
  const out = sentenceRomaji(tokenizer.tokenize(plain), c.sentence, c.sentence_furigana);
  if (out.romaji) romaji.set(c.sentence, out.romaji);
  else failed.set(c.sentence, out.fail);
}

const before = new Map(db.prepare("SELECT sentence, romaji FROM sentence_romaji").all().map((r) => [r.sentence, r.romaji]));
const changed = new Set(
  [...new Set([...romaji.keys(), ...before.keys()])].filter((s) => romaji.get(s) !== before.get(s)),
);
const touched = cards.filter((c) => changed.has(c.sentence));

if (!args["dry-run"]) {
  const now = Math.floor(Date.now() / 1000);
  db.transaction(() => {
    db.prepare("DELETE FROM sentence_romaji").run();
    const insert = db.prepare("INSERT INTO sentence_romaji (sentence, romaji) VALUES (?, ?)");
    for (const [sentence, r] of romaji) insert.run(sentence, r);
    const touch = db.prepare("UPDATE cards SET updated_at = ? WHERE id = ?");
    for (const c of touched) touch.run(now, c.id);
  })();
}

console.log(
  `${args["dry-run"] ? "(dry run) " : ""}${romaji.size} sentences in romaji, ${failed.size} without ` +
    `(${changed.size} changed, ${touched.length} cards sent to the phones again)`,
);
for (const [sentence, why] of failed) console.log(`  no romaji: ${sentence.replace(/<\/?b>/gi, "")} — ${why}`);
db.close();
