#!/usr/bin/env node
/**
 * Switch on the reverse of the cards she has two-way in Noji (#284).
 *
 *   node bin/set-reverse.js --handle HANDLE --file /path/to/two-way.json [--dry-run]
 *
 * The file is an array of `{ noteId }` — Noji's note ids, which the list
 * import kept in `import_source` (import-list.js). It is read from Noji's
 * shared deck (`numberOfCards: 2` on a note) outside the repository and never
 * committed: it is her material, like the lists themselves.
 *
 * Only switches on, never off, and a card whose reverse is already on is left
 * alone — so running it twice changes nothing. A note that matches no live
 * card of hers is reported, not guessed at.
 */
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { config } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { setReverse } from "../src/reverse.js";
import { findByHandle, normaliseHandle } from "../src/users.js";

const args = {};
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === "--dry-run") args.dryRun = true;
  else if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[++i];
}
if (!args.handle || !args.file) {
  console.error("usage: node bin/set-reverse.js --handle HANDLE --file two-way.json [--dry-run]");
  exit(2);
}

const db = openDatabase(config.dbFile);
const user = findByHandle(db, normaliseHandle(args.handle));
if (!user) {
  console.error(`no user ${args.handle}`);
  exit(1);
}

const rows = JSON.parse(readFileSync(args.file, "utf8"));
const find = db.prepare(
  `SELECT id, word_meaning FROM cards
    WHERE owner_id = ? AND deck = 'personal' AND deleted_at IS NULL AND reverse_of IS NULL
      AND json_extract(import_source, '$.noteId') = ?`,
);
const seconds = Math.floor(Date.now() / 1000);
const result = { switchedOn: 0, alreadyOn: 0, notFound: [] };

db.transaction(() => {
  for (const { noteId } of rows) {
    const matches = find.all(user.id, String(noteId));
    // A word in both of her lists is two cards (#137), each with its own note.
    if (matches.length !== 1) {
      result.notFound.push({ noteId, matches: matches.length });
      continue;
    }
    if (args.dryRun) continue;
    if (setReverse(db, matches[0].id, true, seconds)) result.switchedOn += 1;
    else result.alreadyOn += 1;
  }
})();

console.log(`${user.handle} (id ${user.id})${args.dryRun ? " — dry run" : ""}:`, result);
db.close();
