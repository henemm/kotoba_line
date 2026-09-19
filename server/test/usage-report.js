#!/usr/bin/env node
/**
 * How the app feels over a month of use (#242): every usage pattern in
 * simulate-days.js, a fresh simulated learner each, on a `.backup` copy of a
 * real database — real cards and deck settings, none of anyone's answers.
 *
 *   sqlite3 /srv/kotoba/data/kotoba.sqlite ".backup /tmp/copy.sqlite"
 *   node server/test/usage-report.js /tmp/copy.sqlite [--deck kaishi] [--profile realistisch] [--days 30]
 *   node server/test/usage-report.js /tmp/copy.sqlite --handle charlotte --deck deck:1 [--fresh]
 *
 * With `--handle`, the learner is that account — her own decks, her deck
 * settings — carrying on from her own answers, or with `--fresh` from none
 * (they are deleted in the copy, never anywhere else). Her decks are only
 * visible to her account, which is why a made-up learner cannot stand in.
 *
 * Each pattern gets its own fresh copy of the file, so one learner's month
 * cannot leak into the next. Refuses anything under /srv/.
 */
import { copyFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { openDatabase } from "../src/db.js";
import { createUser, findByHandle } from "../src/users.js";
import { dayIn } from "../src/day.js";
import { PATTERNS, PROFILES, experience, simulate } from "./simulate-days.js";

const [path, ...rest] = argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i++) {
  const key = rest[i].replace(/^--/, "");
  opts[key] = rest[i + 1] === undefined || rest[i + 1].startsWith("--") ? true : rest[++i];
}
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
  let user;
  let start = "2026-10-01";
  if (opts.handle) {
    user = findByHandle(db, opts.handle);
    if (!user) throw new Error(`no account ${opts.handle} in the copy`);
    if ("fresh" in opts) {
      for (const table of ["review_events", "card_state"]) db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(user.id);
      db.prepare("UPDATE deck_settings SET extra_new = 0, extra_new_day = NULL WHERE user_id = ?").run(user.id);
    }
    // After her last answer, so no simulated session lands in the past.
    const { last } = db.prepare("SELECT max(reviewed_at) AS last FROM review_events WHERE user_id = ?").get(user.id);
    start = dayIn(Math.max(Math.floor(Date.now() / 1000), last ?? 0) + 86400, "Asia/Tokyo");
  } else {
    user = await createUser(db, { handle: `sim-${name}`.slice(0, 30), display: "Simulation", pin: "483920" });
  }
  const run = simulate(db, user.id, { deckKey, days, start, profile, pattern });
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
console.log(`${opts.handle ? `${opts.handle}${"fresh" in opts ? " (frisch)" : " (ab ihrem Stand)"} · ` : ""}${deckKey} · ${opts.profile ?? "realistisch"} · ${days} Tage`);
for (const row of table) {
  console.log(`\n${row.Nutzung}`);
  for (const [k, v] of Object.entries(row)) if (k !== "Nutzung") console.log(`  ${k.padEnd(28)} ${v}`);
}
exit(failed ? 1 : 0);
