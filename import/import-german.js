#!/usr/bin/env node
/**
 * Die deutschen Bedeutungen und Beispielsätze in die Datenbank (#134).
 *
 *   node import/import-german.js [--db /srv/kotoba/data/kotoba.sqlite] [--dry]
 *
 * Liest import/german.tsv und schreibt das Deutsche nach `word_meaning` und
 * `sentence_meaning` — dorthin, wo der Client die Bedeutung liest. Das
 * Englische wandert vorher nach `word_meaning_en` / `sentence_meaning_en`
 * (migration 034), und zwar **nur, wenn dort noch nichts steht**: das macht
 * den Lauf wiederholbar. Ein erneutes `npm run import` schreibt das Englische
 * aus dem .apkg zurück nach `word_meaning`; dieser Lauf danach setzt das
 * Deutsche wieder ein, ohne das gerettete Englische zu überschreiben.
 *
 * Angefasst werden ausschließlich die Karten-IDs, die in der TSV stehen. Die
 * Kana-Decks tragen in `word_meaning` ihr Romaji (client/src/screens/
 * kana-deck.js liest daraus die Vokalspalte) und ihre eigenen Karten tragen
 * ihr eigenes Deutsch — beide stehen nicht in der Datei und bleiben, wie sie
 * sind. Ein pauschales UPDATE gibt es hier deshalb nicht.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { argv, exit } from "node:process";

const require = createRequire(import.meta.url);
const Database = require("../server/node_modules/better-sqlite3");

const args = Object.fromEntries(
  argv.slice(2).reduce((p, a, i, all) => (a.startsWith("--") ? [...p, [a.slice(2), all[i + 1]]] : p), []),
);
const DB = args.db ?? "/srv/kotoba/data/kotoba.sqlite";
const FILE = args.file ?? "import/german.tsv";
const DRY = "dry" in args;

const rows = readFileSync(FILE, "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => {
    const [id, word, de, satz] = l.split("\t");
    return { id: Number(id), word, de: (de ?? "").trim(), satz: (satz ?? "").trim() };
  });

const db = new Database(DB, { readonly: DRY, fileMustExist: true });
const card = db.prepare("SELECT word_meaning, word_meaning_en, sentence, sentence_meaning, sentence_meaning_en FROM cards WHERE id = ?");

// Das Englische retten, aber nur einmal: COALESCE lässt eine gefüllte Spalte
// in Ruhe, damit ein zweiter Lauf nicht das schon eingesetzte Deutsche als
// „das Englische“ einfriert.
const save = db.prepare(
  `UPDATE cards SET word_meaning_en = COALESCE(word_meaning_en, word_meaning),
                    sentence_meaning_en = COALESCE(sentence_meaning_en, sentence_meaning)
    WHERE id = ?`,
);
const setWord = db.prepare("UPDATE cards SET word_meaning = ?, updated_at = ? WHERE id = ?");
const setSentence = db.prepare("UPDATE cards SET sentence_meaning = ?, updated_at = ? WHERE id = ?");

const now = Math.floor(Date.now() / 1000);
const counts = { rows: rows.length, unknown: 0, word: 0, sentence: 0, unchanged: 0, noSentence: 0 };
const unknown = [];

const run = db.transaction(() => {
  for (const r of rows) {
    const c = card.get(r.id);
    if (!c) {
      counts.unknown += 1;
      unknown.push(`${r.id} (${r.word})`);
      continue;
    }
    save.run(r.id);
    let touched = false;
    if (r.de && c.word_meaning !== r.de) {
      setWord.run(r.de, now, r.id);
      counts.word += 1;
      touched = true;
    }
    // Eine Karte ohne japanischen Satz hat auch keine Übersetzung — 26 im
    // Deck. Die leere Spalte ist dort richtig und wird nicht gemeldet.
    if (!c.sentence?.trim()) counts.noSentence += 1;
    else if (r.satz && c.sentence_meaning !== r.satz) {
      setSentence.run(r.satz, now, r.id);
      counts.sentence += 1;
      touched = true;
    }
    if (!touched) counts.unchanged += 1;
  }
});

if (DRY) {
  // Ohne Transaktion zählen, ohne zu schreiben.
  for (const r of rows) {
    const c = card.get(r.id);
    if (!c) { counts.unknown += 1; unknown.push(`${r.id} (${r.word})`); continue; }
    if (r.de && c.word_meaning !== r.de) counts.word += 1;
    if (!c.sentence?.trim()) counts.noSentence += 1;
    else if (r.satz && c.sentence_meaning !== r.satz) counts.sentence += 1;
  }
} else {
  run();
}

console.log(`${DRY ? "Probelauf" : "Geschrieben"} · ${DB}`);
console.log(`  ${counts.rows} Zeilen gelesen`);
console.log(`  ${counts.word} Bedeutungen ${DRY ? "würden" : ""} gesetzt`);
console.log(`  ${counts.sentence} Beispielsätze ${DRY ? "würden" : ""} gesetzt`);
console.log(`  ${counts.noSentence} Karten ohne Beispielsatz (hat das Deck auch nicht)`);
if (!DRY) console.log(`  ${counts.unchanged} standen schon so da`);
if (unknown.length) {
  console.log(`  ${unknown.length} Karten-IDs gibt es nicht:`);
  for (const u of unknown.slice(0, 10)) console.log(`      ${u}`);
}
db.close();
exit(counts.unknown > 0 ? 1 : 0);
