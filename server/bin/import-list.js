#!/usr/bin/env node
/**
 * Import one of her own vocabulary lists (#137).
 *
 *   node bin/import-list.js --handle HANDLE --file /path/to/list.json
 *
 * The file is an array of rows: { list, position, noteId, front, back,
 * bothDirections, flag, check, kaishiId }. It is prepared outside the
 * repository and never committed — it is her material, like the deck data.
 * See server/src/import-list.js for what happens to each row.
 */
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { config } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { offerKaishiTopics } from "../src/kaishi-topics.js";
import { importList } from "../src/import-list.js";
import { findByHandle, normaliseHandle } from "../src/users.js";

const args = {};
for (let i = 2; i < argv.length; i++) {
  if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[++i];
}
if (!args.handle || !args.file) {
  console.error("usage: node bin/import-list.js --handle HANDLE --file list.json");
  exit(2);
}

const db = openDatabase(config.dbFile);
const user = findByHandle(db, normaliseHandle(args.handle));
if (!user) {
  console.error(`no user ${args.handle}`);
  exit(1);
}

const rows = JSON.parse(readFileSync(args.file, "utf8"));
const result = importList(db, user.id, rows);
console.log(`${user.handle} (id ${user.id}):`, result);
// #209: the new cards take their Kaishi topics now, not at the next restart.
console.log("cards that took Kaishi topics:", offerKaishiTopics(db));

const lists = db
  .prepare(
    `SELECT list_name, count(*) n, count(import_flag) flagged
       FROM cards WHERE owner_id = ? AND list_name IS NOT NULL AND deleted_at IS NULL
      GROUP BY list_name ORDER BY list_name`,
  )
  .all(user.id);
console.log("her lists now:", lists);
db.close();
