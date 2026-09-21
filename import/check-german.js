#!/usr/bin/env node
/**
 * Was die deutschen Bedeutungen zusammenfallen lässt (#134).
 *
 * Zwei Karten mit demselben deutschen Text sind kein Schönheitsfehler: bei
 * „Bedeutung wählen“ werden die falschen Antworten aus anderen Karten
 * genommen (client/src/deck.js, pickDistractors), also stünde die richtige
 * Antwort zweimal da — und sie bekäme „falsch“ für eine richtige Wahl.
 *
 * Gemessen 2026-09-21 am ganzen Deck: trüge jede Karte auf Deutsch nur EIN
 * Wort, fielen 395 Karten zusammen statt der 67, die sich schon auf Englisch
 * eine Bedeutung teilen. Deshalb folgt die Übersetzung der Feinheit des
 * Englischen (import/german.tsv, Konvention 2), und deshalb wird hier
 * gezählt statt gehofft.
 *
 *   node import/check-german.js [--db /srv/kotoba/data/kotoba.sqlite]
 *
 * Ändert nichts. Endet mit 1, wenn zwei Karten denselben Text tragen.
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

const rows = readFileSync(FILE, "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => {
    const [id, word, de, satz, note] = l.split("\t");
    return { id: Number(id), word, de, satz, note: note ?? "" };
  });

const db = new Database(DB, { readonly: true, fileMustExist: true });
const card = db.prepare("SELECT word, word_meaning, sentence FROM cards WHERE id = ?");

let problems = 0;
const say = (kind, lines) => {
  if (lines.length === 0) return;
  problems += lines.length;
  console.log(`\n${kind} (${lines.length}):`);
  for (const l of lines) console.log(`  ${l}`);
};

// 1. Jede Zeile gehört zu einer Karte, und jede Karte kommt einmal vor.
const seen = new Map();
const unknown = [];
const twice = [];
for (const r of rows) {
  if (!card.get(r.id)) unknown.push(`${r.id} (${r.word})`);
  if (seen.has(r.id)) twice.push(`${r.id} (${r.word})`);
  seen.set(r.id, r);
}
say("Karten-ID gibt es nicht", unknown);
say("Karte kommt doppelt vor", twice);

// 2. Leere Felder.
say("Bedeutung fehlt", rows.filter((r) => !r.de?.trim()).map((r) => `${r.id} ${r.word}`));
// 26 Kaishi-Karten tragen selbst keinen Beispielsatz; dort ist die leere
// Spalte richtig. Gemeldet wird nur, wo es einen japanischen Satz gibt.
say("Satz fehlt", rows.filter((r) => !r.satz?.trim() && card.get(r.id)?.sentence?.trim()).map((r) => `${r.id} ${r.word}`));

// 3. Der eigentliche Punkt: zwei Karten, ein Text.
const byText = new Map();
for (const r of rows) {
  const key = r.de.trim().toLowerCase();
  byText.set(key, [...(byText.get(key) ?? []), r]);
}
say(
  "Zwei Karten tragen dieselbe deutsche Bedeutung",
  [...byText.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `„${k}“ → ${v.map((r) => r.word).join(" / ")}`),
);

// 4. Karten, die sich schon auf Englisch eine Bedeutung teilen: hier muss
//    Deutsch sie getrennt haben, sonst ist die Gelegenheit verschenkt.
const enGroups = new Map();
for (const r of rows) {
  const en = card.get(r.id).word_meaning.trim().toLowerCase();
  enGroups.set(en, [...(enGroups.get(en) ?? []), r]);
}
const sharedEn = [...enGroups.entries()].filter(([, v]) => v.length > 1);
const stillSame = sharedEn.filter(([, v]) => new Set(v.map((r) => r.de.trim().toLowerCase())).size === 1);
console.log(`\nAuf Englisch teilen sich ${sharedEn.reduce((n, [, v]) => n + v.length, 0)} Karten eine Bedeutung.`);
for (const [en, v] of sharedEn) {
  const split = new Set(v.map((r) => r.de.trim().toLowerCase())).size > 1;
  console.log(`  ${split ? "getrennt" : "NICHT getrennt"}  „${en}“ → ${v.map((r) => `${r.word}: ${r.de}`).join("  |  ")}`);
}
say("Auf Englisch gleich und auf Deutsch auch noch", stillSame.map(([en]) => en));

// 5. Wörter, die im Deck doppelt vorkommen — die Karten, deretwegen diese
//    Datei auf die Karten-ID geschlüsselt ist (#134).
const byWord = new Map();
for (const r of rows) byWord.set(r.word, [...(byWord.get(r.word) ?? []), r]);
const dupWords = [...byWord.entries()].filter(([, v]) => v.length > 1);
console.log(`\n${dupWords.length} Wörter kommen in diesem Block auf mehreren Karten vor:`);
for (const [w, v] of dupWords) {
  const same = new Set(v.map((r) => r.de.trim().toLowerCase())).size === 1;
  console.log(`  ${same ? "GLEICH GEBLIEBEN" : "unterschieden"}  ${w} → ${v.map((r) => r.de).join("  |  ")}`);
}
say("Doppeltes Wort, gleiche Bedeutung — die Karte ist verloren",
    dupWords.filter(([, v]) => new Set(v.map((r) => r.de.trim().toLowerCase())).size === 1).map(([w]) => w));

console.log(`\n${rows.length} Zeilen geprüft, ${problems} Probleme.`);
db.close();
exit(problems > 0 ? 1 : 0);
