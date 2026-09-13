#!/usr/bin/env node
/**
 * Assign topic tags to imported cards (§8, §5a).
 *
 *   npm run tag                       # apply rules + overrides
 *   npm run tag -- --dry-run          # report coverage, write nothing
 *   npm run tag -- --report           # per-topic counts and untagged sample
 *
 * Re-runnable: tags are rebuilt from scratch each time, so removing a word
 * from the override file removes its tag.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "../server/node_modules/better-sqlite3/lib/index.js";
import {
  FIELDS,
  SITUATIONS,
  TOPICS,
  parseModelPass,
  parseOverrides,
  tagsForCard,
  tagsFromRules,
} from "./lib/tagging.js";

const here = dirname(fileURLToPath(import.meta.url));

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

const args = parseArgs(process.argv.slice(2));
const dataDir = args["data-dir"] ?? process.env.DATA_DIR ?? "./data";
const dbFile = args.db ?? join(dataDir, "kotoba.sqlite");
const overridePath = args.overrides ?? join(here, "tags-overrides.tsv");
const modelPath = args["model-pass"] ?? join(here, "tags-llm.tsv");

if (!existsSync(dbFile)) {
  console.error(`No database at ${dbFile}. Run the import first.`);
  process.exit(2);
}

const overrides = existsSync(overridePath)
  ? parseOverrides(readFileSync(overridePath, "utf8"))
  : new Map();

const modelPass = existsSync(modelPath)
  ? parseModelPass(readFileSync(modelPath, "utf8"))
  : new Map();

const db = new Database(dbFile);
// The deck's cards only. Her own words carry the topics she chose when she
// wrote them, and those live in the same `tags` table: rebuilding it wholesale
// used to wipe every one of them, and then hand her words whatever topics the
// keyword rules guessed instead.
const cards = db.prepare("SELECT id, word, word_meaning FROM cards WHERE deck <> 'personal'").all();

const assignments = [];
let fromOverride = 0;
let fromModel = 0;
for (const card of cards) {
  const tags = tagsForCard(card, overrides, modelPass);
  if (overrides.has(card.word)) fromOverride += 1;
  else if (modelPass.has(String(card.id))) fromModel += 1;
  for (const tag of tags) assignments.push({ card_id: card.id, tag });
}

const taggedCards = new Set(assignments.map((a) => a.card_id));

if (!args["dry-run"]) {
  db.transaction(() => {
    db.prepare("DELETE FROM tags WHERE card_id IN (SELECT id FROM cards WHERE deck <> 'personal')").run();
    const insert = db.prepare("INSERT OR IGNORE INTO tags (card_id, tag) VALUES (?, ?)");
    for (const a of assignments) insert.run(a.card_id, a.tag);
  })();
}

const pct = (n) => `${((n / cards.length) * 100).toFixed(1)}%`;

console.log(`${cards.length} cards, ${taggedCards.size} carry at least one tag (${pct(taggedCards.size)})`);
console.log(
  `${assignments.length} tag assignments — ` +
    `${fromModel} cards from the model pass, ${fromOverride} from the override file`,
);
console.log("");

// Printed as two blocks, because they answer different questions: a field
// says what a card is about, a situation says where she would need it.
for (const [axis, topics] of [["FIELD", FIELDS], ["SITUATION", SITUATIONS]]) {
  console.log(`  ${axis}`);
  for (const topic of topics) {
    const n = assignments.filter((a) => a.tag === topic).length;
    console.log(`    ${topic.padEnd(12)} ${String(n).padStart(4)}  ${"#".repeat(Math.round(n / 8))}`);
  }
  console.log("");
}

if (args.report) {
  console.log("\nUntagged sample (what the rules do not reach):");
  const untagged = cards.filter((c) => !taggedCards.has(c.id));
  for (const c of untagged.slice(0, 30)) {
    console.log(`  ${c.word.padEnd(8)} ${c.word_meaning.slice(0, 50)}`);
  }
  console.log(`  ... and ${Math.max(0, untagged.length - 30)} more`);

  console.log("\nRule-only matches, for spot-checking:");
  for (const c of cards.filter((c) => !overrides.has(c.word) && tagsFromRules(c.word_meaning).length).slice(0, 25)) {
    console.log(
      `  ${c.word.padEnd(8)} ${tagsFromRules(c.word_meaning).join(",").padEnd(18)} ${c.word_meaning.slice(0, 40)}`,
    );
  }
}

if (args["dry-run"]) console.log("\n(dry run — nothing was written)");
db.close();
