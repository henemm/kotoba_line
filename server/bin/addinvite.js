#!/usr/bin/env node
/**
 * Make an invitation code (#260). Accounts are still not made on the web
 * (§10) — a code only lets someone make their own.
 *
 *   npm run addinvite -- --code REISE26 --label "Reise nach Japan" --uses 20 --days 60 --beginner
 *
 * --beginner starts every account it makes with Einstieg on and the
 * Japanese script off, which is what the Reise group wants.
 */
import { argv, exit, stdout } from "node:process";
import { config } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { CODE_PATTERN, cleanCode, createInvite, findInvite } from "../src/invites.js";

const args = {};
for (let i = 2; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) continue;
  const next = argv[i + 1];
  args[a.slice(2)] = next && !next.startsWith("--") ? argv[++i] : true;
}

const code = cleanCode(args.code);
if (!new RegExp(CODE_PATTERN).test(code)) {
  stdout.write("--code is required: 4–32 letters or digits, e.g. --code REISE26\n");
  exit(2);
}

const db = openDatabase(config.dbFile);
if (findInvite(db, code)) {
  stdout.write(`${code} gibt es schon.\n`);
  exit(1);
}

const settings = args.beginner ? { beginner: true, japaneseScript: false } : {};
const invite = createInvite(db, {
  code,
  label: args.label || "Einladung",
  settings,
  maxUses: Number(args.uses ?? 20),
  days: Number(args.days ?? 60),
});

const until = new Date(invite.expires_at * 1000).toLocaleDateString("de-DE");
stdout.write(`${invite.code} angelegt: ${invite.label}, ${invite.max_uses} Anmeldungen, gültig bis ${until}.\n`);
stdout.write(`Link: https://www.henemm.com/kotoba/?einladung=${invite.code}\n`);
