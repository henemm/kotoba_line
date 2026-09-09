#!/usr/bin/env node
/**
 * Create a user. §10: accounts are made here, not through the web interface.
 *
 *   npm run adduser -- --handle mira --display Mira
 *   npm run adduser -- --handle mira --pin 483920      (non-interactive)
 *
 * With no --pin the PIN is prompted for twice, with echo off.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, exit } from "node:process";
import { config } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { createUser, findByHandle, normaliseHandle, validatePin } from "../src/users.js";

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1);
    else out[a.slice(2)] = args[++i];
  }
  return out;
}

/** Prompt without echoing, so the PIN does not land in a screenshot. */
async function promptHidden(question) {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const onData = (char) => {
    // Repaint the prompt so the typed characters never appear.
    if (![ "\n", "\r", "" ].includes(char.toString())) {
      stdout.write("[2K[200D" + question);
    }
  };
  stdin.on("data", onData);
  try {
    return (await rl.question(question)).trim();
  } finally {
    stdin.off("data", onData);
    rl.close();
    stdout.write("\n");
  }
}

const args = parseArgs(argv.slice(2));

const handle = normaliseHandle(args.handle ?? "");
if (!handle) {
  console.error("usage: npm run adduser -- --handle <name> [--display <name>] [--pin <digits>]");
  exit(2);
}

const db = openDatabase(config.dbFile);

if (findByHandle(db, handle)) {
  console.error(`A user with handle "${handle}" already exists.`);
  exit(1);
}

let pin = args.pin;
if (pin === undefined) {
  pin = await promptHidden(`PIN for ${handle} (${config.pinMinLength}+ digits): `);
  const again = await promptHidden("Repeat PIN: ");
  if (pin !== again) {
    console.error("The two PINs do not match.");
    exit(1);
  }
}

const pinError = validatePin(pin);
if (pinError) {
  console.error(pinError);
  exit(1);
}

const user = await createUser(db, { handle, display: args.display, pin });
db.close();

console.log(`Created ${user.handle} (id ${user.id}, display "${user.display}").`);
