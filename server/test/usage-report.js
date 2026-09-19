#!/usr/bin/env node
/**
 * How the app feels over a month of use (#242): every usage pattern in
 * simulate-days.js, a fresh simulated learner each, on a `.backup` copy of a
 * real database — real cards and deck settings, none of anyone's answers.
 *
 *   sqlite3 /srv/kotoba/data/kotoba.sqlite ".backup /tmp/copy.sqlite"
 *   node server/test/usage-report.js /tmp/copy.sqlite [--deck kaishi] [--profile realistisch] [--days 30]
 *
 * Each pattern gets its own fresh copy of the file, so one learner's month
 * cannot leak into the next. Refuses anything under /srv/.
 */
import { copyFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { openDatabase } from "../src/db.js";
import { createUser } from "../src/users.js";
import { PATTERNS, PROFILES, experience, simulate } from "./simulate-days.js";

const [path, ...rest] = argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
if (!path || realpathSync(path).startsWith("/srv/")) {
  console.error("usage: usage-report.js <copy.sqlite> — a .backup copy, never the live database");
  exit(2);
}
const profile = PROFILES[opts.profile ?? "realistisch"];
const days = Number(opts.days ?? 30);
const deckKey = opts.deck ?? "kaishi";
const dir = mkdtempSync(join(tmpdir(), "usage-"));

const RATINGS = [["neu:1", "Neu, Nochmal"], ["neu:2", "Neu, Schwer"], ["neu:3", "Neu, Gut"], ["neu:4", "Neu, Leicht"], ["gesehen:3", "Wiederholung, Gut"]];
let failed = 0;
const table = [];
for (const [name, pattern] of Object.entries(PATTERNS)) {
  const file = join(dir, `${name}.sqlite`);
  copyFileSync(path, file);
  const db = openDatabase(file);
  const user = await createUser(db, { handle: `sim-${name}`.slice(0, 30), display: "Simulation", pin: "483920" });
  const run = simulate(db, user.id, { deckKey, days, start: "2026-10-01", profile, pattern });
  db.close();
  failed += run.violations.length;
  const x = experience(run.showings);
  const active = run.rows.filter((r) => r.sessions > 0);
  const row = {
    Nutzung: name,
    "neu/Tag": (active.reduce((n, r) => n + r.fresh, 0) / active.length).toFixed(1),
    "Karten/Tag": (active.reduce((n, r) => n + r.fresh + r.reviews + r.reshown, 0) / active.length).toFixed(0),
    "neues Wort, 1. Tag gezeigt": `${x.firstDay.median}× (nur 1×: ${x.firstDay.once} %)`,
    Verstöße: run.violations.length,
  };
  for (const [key, title] of RATINGS) {
    const r = x.ratings[key];
    row[title] = r ? `${r.label} → ${r.median} (gleiche Übung ${r.sameSession} %)` : "–";
  }
  table.push(row);
  for (const v of run.violations.slice(0, 5)) console.log(`${name}: ${v}`);
}
rmSync(dir, { recursive: true });
console.log(`${deckKey} · ${opts.profile ?? "realistisch"} · ${days} Tage`);
for (const row of table) {
  console.log(`\n${row.Nutzung}`);
  for (const [k, v] of Object.entries(row)) if (k !== "Nutzung") console.log(`  ${k.padEnd(28)} ${v}`);
}
exit(failed ? 1 : 0);
