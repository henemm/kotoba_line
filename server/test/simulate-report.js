#!/usr/bin/env node
/**
 * The multi-day simulation (#242) against a copy of a real database, as a
 * day-by-day table.
 *
 *   sqlite3 /srv/kotoba/data/kotoba.sqlite ".backup /tmp/copy.sqlite"
 *   node server/test/simulate-report.js /tmp/copy.sqlite --handle <handle>
 *   node server/test/simulate-report.js /tmp/copy.sqlite --profile schwach --days 60
 *
 * With `--handle`, the simulation carries on from that account's own history,
 * cards and deck settings — in the copy. Without it, a fresh account is made
 * in the copy and starts from nothing. Either way the copy is written to and
 * is worth nothing afterwards; the live database is refused outright.
 */
import { realpathSync } from "node:fs";
import { argv, exit } from "node:process";
import { openDatabase } from "../src/db.js";
import { dayIn } from "../src/day.js";
import { createUser, findByHandle } from "../src/users.js";
import { PROFILES, rebuildMatches, simulate } from "./simulate-days.js";

const [path, ...rest] = argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];

if (!path) {
  console.error("usage: simulate-report.js <copy.sqlite> [--handle h] [--profile fleissig|schwach|luecke] [--days n] [--deck kaishi]");
  exit(2);
}
if (realpathSync(path).startsWith("/srv/")) {
  console.error("Refusing: that is the live database. Simulate on a .backup copy.");
  exit(2);
}

const db = openDatabase(path);
const profile = PROFILES[opts.profile ?? "fleissig"];
if (!profile) {
  console.error(`unknown profile ${opts.profile}`);
  exit(2);
}
const user = opts.handle
  ? findByHandle(db, opts.handle)
  : await createUser(db, { handle: `sim${Date.now() % 100000}`, display: "Simulation", pin: "483920" });
if (!user) {
  console.error(`no account ${opts.handle} in the copy`);
  exit(2);
}

// The day after today or after the account's last answer, whichever is later:
// a simulated session before an answer already in the log would be a session
// in the past, and its "new today" would count that answer.
const { last } = db.prepare("SELECT max(reviewed_at) AS last FROM review_events WHERE user_id = ?").get(user.id);
const start = dayIn(Math.max(Math.floor(Date.now() / 1000), last ?? 0) + 86400, "Asia/Tokyo");
const result = await simulate(db, user.id, {
  deckKey: opts.deck ?? "kaishi",
  days: Number(opts.days ?? 30),
  start,
  profile,
});

console.log(`${opts.handle ?? "new account"} · ${opts.profile ?? "fleissig"} · ${result.newPerDay} new a day · from ${start}`);
console.table(result.rows);
console.log(`violations: ${result.violations.length}`);
for (const v of result.violations.slice(0, 30)) console.log(`  ${v}`);
console.log(`card_state folds back to itself: ${rebuildMatches(db, user.id)}`);
exit(result.violations.length ? 1 : 0);
