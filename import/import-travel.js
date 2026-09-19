#!/usr/bin/env node
/**
 * Reise 1 and Reise 2 into the app's database (#237).
 *
 *   npm run import-travel -- --db /srv/kotoba/data/kotoba.sqlite
 *   npm run import-travel -- --db … --dry-run
 *
 * Writes the phrases import/travel.tsv adds to the Kaishi deck, and files
 * every listed card — Kaishi's own and the added ones — under "travel 1" or
 * "travel 2". Run after the Kaishi import (it checks every Kaishi row against
 * the deck) and again after `npm run tag`, which rebuilds Kaishi's tags.
 * tag-cards.js reads the same file, so either order ends with the topics on.
 *
 * Re-runnable: ids are fixed in the file, a row whose content is unchanged
 * keeps its `updated_at` (phones are not sent it again), and the travel
 * topics are replaced as a whole, so a card taken out of the file loses them.
 * An added phrase taken out of the file is soft-deleted, never removed —
 * `review_events` may point at it.
 *
 * The added phrases have no recording. The nightly generate-word-sounds run
 * gives each one the generated voice; `ops/status.sh` says while any wait.
 */
import { readFileSync } from "node:fs";
import { openDatabase } from "../server/src/db.js";
import { TRAVEL_ID_FLOOR, TRAVEL_TOPICS, handTagged, parseTravel, travelAssignments } from "./lib/travel.js";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : [],
  ),
);
if (!args.db) {
  process.stderr.write("--db is required (see the comment at the top of this file)\n");
  process.exit(2);
}

const rows = parseTravel(readFileSync(new URL("./travel.tsv", import.meta.url), "utf8"));
const db = openDatabase(args.db);
const now = Math.floor(Date.now() / 1000);

// Every Kaishi row must name the card it says it does: an id typed wrong
// would otherwise file some other word under Reise, silently.
const kaishi = db.prepare("SELECT word FROM cards WHERE id = ? AND deck = 'kaishi' AND deleted_at IS NULL");
for (const r of rows.filter((r) => r.kaishi)) {
  const found = kaishi.get(r.id);
  if (!found) throw new Error(`Kaishi card ${r.id} (${r.word}) is not in the database — run the Kaishi import first`);
  if (found.word !== r.word) throw new Error(`Kaishi card ${r.id} is ${found.word}, the file says ${r.word}`);
}

const existing = db.prepare("SELECT word, word_reading, word_meaning, deleted_at FROM cards WHERE id = ?");
const upsert = db.prepare(
  `INSERT INTO cards (id, word, word_reading, word_meaning, deck, updated_at)
   VALUES (@id, @word, @reading, @meaning, 'kaishi', @now)
   ON CONFLICT(id) DO UPDATE SET
     word = excluded.word, word_reading = excluded.word_reading,
     word_meaning = excluded.word_meaning, deleted_at = NULL, updated_at = excluded.updated_at`,
);
const added = rows.filter((r) => !r.kaishi);
let written = 0;
let retired = 0;

if (!args["dry-run"]) {
  db.transaction(() => {
    for (const r of added) {
      const row = existing.get(r.id);
      const same = row && row.deleted_at == null && row.word === r.word && row.word_reading === r.reading && row.word_meaning === r.meaning;
      if (same) continue;
      upsert.run({ id: r.id, word: r.word, reading: r.reading, meaning: r.meaning, now });
      written += 1;
    }
    // A phrase no longer in the file: soft-deleted, as a card is (rule 4).
    const keep = new Set(added.map((r) => r.id));
    for (const { id } of db
      .prepare("SELECT id FROM cards WHERE deck = 'kaishi' AND id >= ? AND deleted_at IS NULL")
      .all(TRAVEL_ID_FLOOR)) {
      if (keep.has(id)) continue;
      db.prepare("UPDATE cards SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
      retired += 1;
    }
    // The round topics everywhere, and every topic of an added phrase: both
    // come from the file alone, so they are replaced whole.
    const topics = Object.values(TRAVEL_TOPICS);
    db.prepare(`DELETE FROM tags WHERE tag IN (${topics.map(() => "?").join(",")})`).run(...topics);
    const clear = db.prepare("DELETE FROM tags WHERE card_id = ?");
    for (const id of handTagged(rows)) clear.run(id);
    const insert = db.prepare("INSERT OR IGNORE INTO tags (card_id, tag) VALUES (?, ?)");
    for (const a of travelAssignments(rows)) insert.run(a.card_id, a.tag);
  })();
}

const count = (round) => rows.filter((r) => r.round === round).length;
console.log(
  `${args["dry-run"] ? "(dry run) " : ""}Reise 1: ${count(1)} cards, Reise 2: ${count(2)} cards — ` +
    `${rows.filter((r) => r.kaishi).length} from Kaishi, ${added.length} added; ` +
    `${written} added phrase(s) written, ${retired} retired`,
);
db.close();
