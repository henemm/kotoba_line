#!/usr/bin/env node
/**
 * The human recordings for Reise's own phrases (#252), from Wikimedia
 * Commons — see import/lib/travel-sounds.js for which, and why only those.
 *
 *   npm run import-travel-sounds -- --db /srv/kotoba/data/kotoba.sqlite --media /srv/kotoba/media
 *
 * Re-runnable and offline-friendly: a file already on disk is left alone,
 * exactly as the kana recordings are, and only a card whose `word_audio`
 * does not yet name it is written. Run after `npm run import-travel`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../server/src/db.js";
import { decodeWav } from "./lib/encode-mp3.js";
import { withGain } from "./lib/mp3gain.js";
import { TRAVEL_SOUNDS, travelSoundMediaName } from "./lib/travel-sounds.js";
import { activeLevel, gainSteps, parseWav } from "./lib/wav-level.js";

const USER_AGENT = "kotoba-line-import/1.0 (https://www.henemm.com/kotoba/; travel phrases)";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : [],
  ),
);
if (!args.db || !args.media) {
  process.stderr.write("--db and --media are required (see the comment at the top of this file)\n");
  process.exit(2);
}

// nginx (www-data) has to read what this writes — the trap in CLAUDE.md, and
// the reason the first run produced two files only the importer could open.
process.umask(0o022);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function commonsInfo(files) {
  const titles = files.map((f) => `File:${f}`).join("|");
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=sha1|url|user&titles=" +
    encodeURIComponent(titles);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Wikimedia Commons: HTTP ${res.status}`);
  const { query } = await res.json();
  const asked = new Map((query.normalized ?? []).map((n) => [n.to, n.from]));
  return new Map(Object.values(query.pages).map((p) => [asked.get(p.title) ?? p.title, p.imageinfo?.[0]]));
}

const db = openDatabase(args.db);
mkdirSync(args.media, { recursive: true });

const missing = TRAVEL_SOUNDS.filter((s) => !existsSync(join(args.media, travelSoundMediaName(s))));
const info = missing.length ? await commonsInfo(missing.map((s) => s.commons)) : new Map();

for (const [n, sound] of missing.entries()) {
  const found = info.get(`File:${sound.commons}`);
  if (!found) throw new Error(`Wikimedia Commons has no File:${sound.commons} (${sound.word})`);
  if (found.sha1 !== sound.sha1 || found.user !== sound.user) {
    throw new Error(
      `File:${sound.commons} (${sound.word}) is not the recording pinned in lib/travel-sounds.js: sha1 ${found.sha1}, uploaded by ${found.user}`,
    );
  }
  // Wikimedia's MP3 transcode beside the Ogg original, which iOS does not
  // reliably play — the same route the kana recordings take.
  const [h, hh, name] = new URL(found.url).pathname.split("/").slice(-3);
  if (n > 0) await sleep(2000);
  const res = await fetch(`https://upload.wikimedia.org/wikipedia/commons/transcoded/${h}/${hh}/${name}/${name}.mp3`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`${sound.word}: HTTP ${res.status}`);
  const mp3 = Buffer.from(await res.arrayBuffer());
  // Levelled to the loudness of every other recording on a card, measured
  // from the audio itself rather than from a number written down once.
  const steps = gainSteps(activeLevel(parseWav(await decodeWav(mp3))));
  writeFileSync(join(args.media, travelSoundMediaName(sound)), withGain(mp3, steps));
  process.stdout.write(`${sound.word} ← ${sound.commons} (${steps > 0 ? "+" : ""}${(steps * 1.5).toFixed(1)} dB)\n`);
}

let written = 0;
const now = Math.floor(Date.now() / 1000);
for (const sound of TRAVEL_SOUNDS) {
  const file = travelSoundMediaName(sound);
  const card = db.prepare("SELECT id, word, word_audio FROM cards WHERE id = ? AND deleted_at IS NULL").get(sound.cardId);
  if (!card) throw new Error(`card ${sound.cardId} (${sound.word}) is not in the database — run import-travel first`);
  if (card.word !== sound.word) throw new Error(`card ${sound.cardId} now says ${card.word}, not ${sound.word}`);
  if (card.word_audio === file) continue;
  db.prepare("UPDATE cards SET word_audio = ?, updated_at = ? WHERE id = ?").run(file, now, sound.cardId);
  written += 1;
}

process.stdout.write(
  `${TRAVEL_SOUNDS.length} Aufnahmen: ${missing.length} geholt, ${TRAVEL_SOUNDS.length - missing.length} schon da; ${written} Karten aktualisiert\n`,
);
