/**
 * Generated audio for every word that has no recording (#183).
 *
 *   node import/generate-word-sounds.js --db /srv/kotoba/data/kotoba.sqlite --media /srv/kotoba/media \
 *     --wadoku <wadokudict2> --kanjium <accents.txt> [--voicevox http://127.0.0.1:50021] [--dry-run]
 *
 * Needs a running VOICEVOX (ops/generate-word-sounds.sh starts one for the
 * run and stops it again) and two dictionaries that are data, not code, so
 * not in the repository: Wadoku's EDICT export (wadoku.de, "wadokudict2") and
 * Kanjium's accents.txt (github.com/mifunetoshiro/kanjium, CC BY-SA 4.0).
 *
 * Idempotent: only cards whose word has neither a recording nor a generated
 * file for its current text are touched, so a nightly run does nothing until
 * she adds or edits a card. Run under `umask 022` — nginx reads the files.
 *
 * A card is left silent, and listed, when what VOICEVOX would say is not
 * what her romaji says (e.g. またはなそう read as "mata wa naso"): no sound
 * beats a wrong word. `word-sound-overrides.tsv` is where such a card is fixed.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../server/src/db.js";
import { kanaPreview } from "../client/src/typing.js";
import { encodeMp3 } from "./lib/encode-mp3.js";
import { VOICEVOX_CREDIT, VOICEVOX_SPEAKER } from "./lib/kana-yoon-sounds.js";
import { withGain } from "./lib/mp3gain.js";
import { activeLevel, gainSteps, parseWav } from "./lib/wav-level.js";
import {
  decideAccent,
  parseKanjium,
  parseOverrides,
  parseWadoku,
  planCard,
  resolveText,
  sameSound,
  tokenize,
  wordSoundName,
} from "./lib/word-sounds.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
for (const required of ["db", "media", "wadoku", "kanjium"]) {
  if (!args[required]) {
    process.stderr.write(`--${required} is required (see the comment at the top of this file)\n`);
    process.exit(2);
  }
}
const voicevox = args.voicevox ?? "http://127.0.0.1:50021";
const dryRun = Boolean(args["dry-run"]);

async function audioQuery(text) {
  const res = await fetch(`${voicevox}/audio_query?speaker=${VOICEVOX_SPEAKER}&text=${encodeURIComponent(text)}`, { method: "POST" });
  if (!res.ok) throw new Error(`VOICEVOX audio_query for ${text}: HTTP ${res.status}`);
  return res.json();
}
async function synthesize(query) {
  const res = await fetch(`${voicevox}/synthesis?speaker=${VOICEVOX_SPEAKER}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!res.ok) throw new Error(`VOICEVOX synthesis: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
const moraText = (query) => query.accent_phrases.flatMap((p) => p.moras.map((m) => m.text)).join("");
const readingOf = async (text) => moraText(await audioQuery(text));

const db = openDatabase(args.db);
const wadoku = parseWadoku(readFileSync(args.wadoku, "utf8"));
const kanjium = parseKanjium(readFileSync(args.kanjium, "utf8"));
const overrides = parseOverrides(readFileSync(new URL("./word-sound-overrides.tsv", import.meta.url), "utf8"));
const common = new Set(db.prepare("SELECT word FROM cards WHERE deck = 'kaishi' AND deleted_at IS NULL").all().map((r) => r.word));

const cards = db
  .prepare(
    `SELECT id, word, word_meaning, word_reading, word_pitch, deck FROM cards
      WHERE deleted_at IS NULL AND word_audio IS NULL
        AND deck NOT IN ('hiragana', 'katakana')
        AND (word_audio_generated IS NULL OR word_audio_generated_for IS NOT word)`,
  )
  .all();

const update = db.prepare(
  `UPDATE cards SET word_audio_generated = ?, word_audio_generated_for = word, word_audio_checked = ?, updated_at = ?
    WHERE id = ? AND word = ?`,
);

let written = 0;
let checked = 0;
const silent = [];
mkdirSync(args.media, { recursive: true });
for (const card of cards) {
  const draft = planCard(card, { wadoku, kanjium, overrides, common });
  if (!draft) {
    silent.push(`${card.word} (nothing to say)`);
    continue;
  }
  const plan = await resolveText(draft, readingOf);
  const query = await audioQuery(plan.text);

  // What she wrote, as sound; the deck's own Japanese cards are exempt.
  if (/[a-z]/i.test(card.word)) {
    const expected = tokenize(card.word).filter((t) => t.romaji).map((t) => kanaPreview(t.romaji)).join("");
    if (!sameSound(moraText(query), expected)) {
      silent.push(`${card.word} → VOICEVOX would say ${moraText(query)}`);
      continue;
    }
  }

  const accent = decideAccent(plan, query.accent_phrases);
  if (accent.accent != null) query.accent_phrases[0].accent = accent.accent;
  if (accent.checked) checked++;
  if (dryRun) {
    process.stdout.write(`${accent.checked ? "  " : "* "}${card.word} → ${plan.text}\n`);
    written++;
    continue;
  }

  const wav = await synthesize(query);
  const mp3 = withGain(
    await encodeMp3(wav, { artist: VOICEVOX_CREDIT, comment: "Generated audio, not a human recording (#183)" }),
    gainSteps(activeLevel(parseWav(wav))),
  );
  const name = wordSoundName(card.id, plan.text);
  writeFileSync(join(args.media, name), mp3, { mode: 0o644 });
  // `AND word = ?`: a card she edited while this ran keeps its silence.
  update.run(name, accent.checked ? 1 : 0, Math.floor(Date.now() / 1000), card.id, card.word);
  written++;
}

process.stdout.write(
  `${dryRun ? "Would write" : "Wrote"} ${written} of ${cards.length} (${checked} with a checked accent, ${written - checked} with the asterisk).\n`,
);
if (silent.length) process.stdout.write(`Left silent (${silent.length}):\n  ${silent.join("\n  ")}\n`);
