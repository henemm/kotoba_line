#!/usr/bin/env node
/**
 * Rebuild card_state from review_events for everyone (§3), and say what moved.
 *
 *   docker compose -f ops/docker-compose.yml exec api node bin/replay.js
 *
 * Needed after anything that changes what a fold of the same events gives —
 * the scheduler's parameters above all (#242, Noji's intervals): until then a
 * card's stored state is from the old rules, and it only changes once she
 * answers it again. Take a `.backup` of the database first.
 */
import { config } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { replayCardState } from "../src/replay.js";

const db = openDatabase(config.dbFile);
const before = new Map(
  db.prepare("SELECT user_id, card_id, due_at FROM card_state").all().map((r) => [`${r.user_id}:${r.card_id}`, r.due_at]),
);
const { cards, events } = replayCardState(db);
let moved = 0;
for (const r of db.prepare("SELECT user_id, card_id, due_at FROM card_state").all()) {
  if (before.get(`${r.user_id}:${r.card_id}`) !== r.due_at) moved += 1;
}
console.log(`${events} events → ${cards} cards rebuilt, ${moved} with a different due date`);
