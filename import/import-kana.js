#!/usr/bin/env node
/**
 * Write the hiragana and katakana decks into the app's database (#158), and
 * the stroke-order drawings for them into the media directory.
 *
 *   npm run import-kana
 *   npm run import-kana -- --db /srv/kotoba/data/kotoba.sqlite --media /srv/kotoba/media
 *   npm run import-kana -- --no-strokes      # no stroke-order drawings
 *   npm run import-kana -- --no-examples     # keep the example words as they are
 *   npm run import-kana -- --no-sounds       # keep the kana recordings as they are
 *   npm run import-kana -- --voicevox http://127.0.0.1:50021   # only if new VOICEVOX audio is missing
 *
 * Re-runnable. A card's id comes from its characters (lib/kana.js), so a
 * second run finds the same rows, and only a row whose content changed gets a
 * new `updated_at` — the phones are not sent 208 unchanged cards again.
 *
 * The drawings are KanjiVG's (CC BY-SA 3.0, https://kanjivg.tagaini.net),
 * copied unchanged with their copyright header, from one pinned release so a
 * re-run cannot quietly pick up a different drawing. A file already on disk is
 * left alone. Run under `umask 022`, as the Kaishi import: nginx reads these.
 *
 * Example words (v78) come from Kaishi — so run this after the Kaishi import —
 * and from the JLPT lists with JMdict's meanings, both pinned below
 * (lib/examples.js says why each).
 *
 * The kana's own sounds (v84) are recordings from Wikimedia Commons, each
 * pinned by the original's sha1 and brought to one loudness on the way in
 * (lib/kana-sounds.js). They are written before the cards, so a card never
 * points at a recording that is not on disk. So are the example words'
 * recordings from Lingua Libre and Tofugu (v87, lib/example-sounds.js), and
 * two generated sets through a local VOICEVOX rather than downloaded: the 33
 * yōon (v92, #183, lib/kana-yoon-sounds.js says why a generated recording is
 * defensible for these) and 92 example words whose pitch accent is agreed by
 * two independent dictionaries (v93, #183 gap (a), lib/generated-example-sounds.js).
 * A file already on disk is left alone here too, so VOICEVOX only has to be
 * running for the first import.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../server/src/db.js";
import { kanaReading } from "../client/src/screens/session.js";
import { EXAMPLE_SOUNDS, TOFUGU_COMMIT, exampleSoundName } from "./lib/example-sounds.js";
import { MNEMONICS, mnemonicAssetName, mnemonicFor, mnemonicMediaName } from "./lib/kana-mnemonics.js";
import { makeMeaningLookup, parseJlptCsv, pickExamples } from "./lib/examples.js";
import { YOON, kanaCards, strokeCharacters, strokeFile } from "./lib/kana.js";
import { COMMONS_UPLOADER, KANA_SOUNDS, kanaSoundFile, soundMediaName } from "./lib/kana-sounds.js";
import { VOICEVOX_CREDIT, yoonAudioQuery, yoonSoundMediaName, yoonSynthesize } from "./lib/kana-yoon-sounds.js";
import {
  GENERATED_EXAMPLE_SOUNDS,
  VOICEVOX_CREDIT as EXAMPLE_VOICEVOX_CREDIT,
  generatedAudioQuery,
  generatedExampleSoundName,
  generatedSynthesize,
} from "./lib/generated-example-sounds.js";
import { encodeMp3 } from "./lib/encode-mp3.js";
import { activeLevel, gainSteps, parseWav } from "./lib/wav-level.js";
import { withGain } from "./lib/mp3gain.js";
import { readCentralDirectory, readEntry } from "./lib/zip.js";

export const KANJIVG_RELEASE = "r20250816";

/**
 * The JLPT lists, as CSV: tanos.co.uk's own pages send scripts an HTTP 500, so
 * this is Bluskyo's conversion of them at a fixed commit. Checked against a
 * second, independent conversion (jamsinclair/open-anki-jlpt-decks) on the
 * katakana words: N5 57 of 58 shared, N4 37 of 40 — the rest are words the two
 * file under neighbouring levels.
 */
export const JLPT_CSV =
  "https://raw.githubusercontent.com/Bluskyo/JLPT_Vocabulary/4358f932937ad0232194a36e9f4f875094910c6b/data/vocab/parsedData";

/** JMdict's common words with English glosses, as JSON, from one dated release. */
export const JMDICT_RELEASE = "3.6.2+20260914172325";
const JMDICT_ZIP = `https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(JMDICT_RELEASE)}/jmdict-eng-common-${encodeURIComponent(JMDICT_RELEASE)}.json.zip`;

/** Where the app looks for a character's drawing: flat, like the audio (see audio.js mediaUrl). */
export const strokeMediaName = (char) => `kanjivg-${strokeFile(char)}`;

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

/**
 * Upsert the kana cards. Returns how many rows were new or changed.
 * Exported for the test, which runs it against an in-memory database.
 *
 * `sounds` writes each card's recording into `word_audio` (v84); the caller
 * has put the files on disk first.
 */
export function writeKanaCards(db, now = Math.floor(Date.now() / 1000), examples, { sounds = false, mnemonics = false } = {}) {
  const fields = ["word", "word_reading", "word_meaning", "frequency_rank", "deck"];
  // Without `examples` (--no-examples, or a test of the cards alone) the
  // column is left as it is rather than cleared; `word_audio` likewise.
  if (examples) fields.push("word_examples");
  if (sounds) fields.push("word_audio");
  if (mnemonics) fields.push("word_mnemonic");
  const existing = db.prepare(`SELECT ${fields.join(", ")}, deleted_at FROM cards WHERE id = ?`);
  const upsert = db.prepare(
    `INSERT INTO cards (id, ${fields.join(", ")}, updated_at)
     VALUES (@id, ${fields.map((f) => `@${f}`).join(", ")}, @updated_at)
     ON CONFLICT (id) DO UPDATE SET
       ${fields.map((f) => `${f} = excluded.${f}`).join(",\n       ")},
       deleted_at = NULL,
       updated_at = excluded.updated_at`,
  );
  let changed = 0;
  db.transaction(() => {
    for (const kanaCard of kanaCards()) {
      const found = examples?.get(kanaCard.id) ?? [];
      const card = { ...kanaCard };
      if (examples) card.word_examples = found.length ? JSON.stringify(found) : null;
      if (sounds) card.word_audio = kanaSoundFile(kanaCard.word);
      if (mnemonics) {
        const picture = mnemonicFor(kanaCard.word);
        card.word_mnemonic = picture ? JSON.stringify(picture) : null;
      }
      const row = existing.get(card.id);
      const same = row && row.deleted_at == null && fields.every((k) => row[k] === card[k]);
      if (same) continue;
      upsert.run({ ...card, updated_at: now });
      changed += 1;
    }
  })();
  return changed;
}

/**
 * Example words for every kana card, from Kaishi in `db`, the given JLPT rows
 * and JMdict words, and `sounds` — rows of lib/example-sounds.js (v87) and
 * lib/generated-example-sounds.js (v93, #183) whose files are on disk. A
 * sound whose word JMdict does not give a meaning for is left out, as a list
 * word would be.
 */
export function kanaExamples(db, { jlpt, jmdictWords, sounds = [] }) {
  const kaishi = db
    .prepare(
      `SELECT word, word_furigana, word_reading, word_meaning, word_audio FROM cards
        WHERE deck = 'kaishi' AND deleted_at IS NULL AND word_meaning IS NOT NULL
        ORDER BY frequency_rank IS NULL, frequency_rank, id`,
    )
    .all()
    // v83: the card's own recording travels with the word, so a word written
    // twice in Kaishi (もう, 聞く) keeps the recording of the card it came from.
    .map((c) => ({
      reading: kanaReading(c.word_furigana) ?? c.word_reading ?? c.word,
      meaning: c.word_meaning,
      audio: c.word_audio ?? undefined,
    }));
  const meaningOf = makeMeaningLookup(jmdictWords);
  const recorded = sounds.map((s) => ({
    reading: s.reading,
    meaning: meaningOf({ written: s.written, reading: s.reading }),
    audio: exampleSoundName(s),
    source: s.source,
  }));
  return new Map(kanaCards().map((card) => [card.id, pickExamples(card, { kaishi, recorded, jlpt, meaningOf })]));
}

async function loadExampleSources() {
  const jlpt = [];
  for (const level of [5, 4, 3]) {
    const url = `${JLPT_CSV}/n${level}_vocab_cleaned.csv`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`JLPT N${level}: HTTP ${res.status} (${url})`);
    jlpt.push(...parseJlptCsv(await res.text(), level));
  }
  const res = await fetch(JMDICT_ZIP, { redirect: "follow" });
  if (!res.ok) throw new Error(`JMdict: HTTP ${res.status} (${JMDICT_ZIP})`);
  const zip = Buffer.from(await res.arrayBuffer());
  const [entry] = [...readCentralDirectory(zip).values()].filter((e) => e.name.endsWith(".json"));
  if (!entry) throw new Error("JMdict: no JSON in the release archive");
  const jmdictWords = JSON.parse(readEntry(zip, entry).toString("utf8")).words;
  return { jlpt, jmdictWords };
}

const USER_AGENT = "kotoba-line-import/1.0 (https://www.henemm.com/kotoba/; kana decks)";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * upload.wikimedia.org answers HTTP 429 after about a dozen quick requests
 * (measured 2026-09-15), so one at a time, a pause between, and a longer one
 * when it asks for it.
 */
async function politeFetch(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status !== 429 || attempt === 6) return res;
    await sleep(5000 * attempt);
  }
}

/**
 * The Commons recordings, levelled, as `kana-<code point>.mp3` (v84).
 *
 * Commons is asked first for each original's sha1 and uploader, and a file
 * that is not the one pinned in lib/kana-sounds.js stops the import: its gain
 * steps were measured on that recording and no other. The audio itself is
 * Wikimedia's MP3 transcode of the original, because iOS does not reliably
 * play the Ogg Vorbis upload. A file already on disk is left alone, as the
 * drawings are.
 */
async function writeSounds(mediaDir) {
  mkdirSync(mediaDir, { recursive: true });
  const missing = KANA_SOUNDS.filter((s) => !existsSync(join(mediaDir, soundMediaName(s.kana))));
  const info = new Map();
  for (let i = 0; i < missing.length; i += 50) {
    const titles = missing.slice(i, i + 50).map((s) => `File:${s.commons}`);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=sha1|url|user&titles=${encodeURIComponent(titles.join("|"))}`;
    const res = await politeFetch(url);
    if (!res.ok) throw new Error(`Wikimedia Commons: HTTP ${res.status} (${url})`);
    const { query } = await res.json();
    const asked = new Map((query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of Object.values(query.pages)) info.set(asked.get(page.title) ?? page.title, page.imageinfo?.[0]);
  }
  for (const [n, sound] of missing.entries()) {
    const found = info.get(`File:${sound.commons}`);
    if (!found) throw new Error(`Wikimedia Commons has no File:${sound.commons} (${sound.kana})`);
    if (found.sha1 !== sound.sha1 || found.user !== COMMONS_UPLOADER) {
      throw new Error(
        `File:${sound.commons} (${sound.kana}) is not the recording pinned in lib/kana-sounds.js: sha1 ${found.sha1}, uploaded by ${found.user}`,
      );
    }
    // The transcode sits beside the original: …/commons/e/ed/Ja-A.oga → …/commons/transcoded/e/ed/Ja-A.oga/Ja-A.oga.mp3
    const [h, hh, name] = new URL(found.url).pathname.split("/").slice(-3);
    const url = `https://upload.wikimedia.org/wikipedia/commons/transcoded/${h}/${hh}/${name}/${name}.mp3`;
    if (n > 0) await sleep(2000);
    const res = await politeFetch(url);
    if (!res.ok) throw new Error(`${sound.kana}: HTTP ${res.status} (${url})`);
    // withGain also refuses anything but the MPEG-1 Layer III it was written for.
    writeFileSync(join(mediaDir, soundMediaName(sound.kana)), withGain(Buffer.from(await res.arrayBuffer()), sound.steps));
  }
  return { written: missing.length, kept: KANA_SOUNDS.length - missing.length };
}

/**
 * The 33 yōon (#183): generated once through a local VOICEVOX
 * (docker run -p 127.0.0.1:50021:50021 voicevox/voicevox_engine:cpu-ubuntu20.04-latest),
 * levelled to the same target as the Commons recordings, and then left
 * alone, exactly like `writeSounds` above. Skips VOICEVOX entirely once all
 * 33 files exist, so an ordinary re-import needs no container running.
 */
async function writeYoonSounds(mediaDir, voicevoxUrl) {
  mkdirSync(mediaDir, { recursive: true });
  const missing = YOON.filter(([kana]) => !existsSync(join(mediaDir, yoonSoundMediaName(kana))));
  for (const [kana] of missing) {
    let wav;
    try {
      const query = await yoonAudioQuery(kana, voicevoxUrl);
      wav = await yoonSynthesize(query, voicevoxUrl);
    } catch (err) {
      throw new Error(
        `VOICEVOX at ${voicevoxUrl} is unreachable, needed for ${kana}. Start it with ` +
          `'docker run -d --rm -p 127.0.0.1:50021:50021 voicevox/voicevox_engine:cpu-ubuntu20.04-latest' ` +
          `and retry, or pass --voicevox. (${err.message})`,
      );
    }
    const steps = gainSteps(activeLevel(parseWav(wav)));
    const mp3 = withGain(await encodeMp3(wav, { artist: VOICEVOX_CREDIT, comment: "Generated audio, not a human recording (#183)" }), steps);
    writeFileSync(join(mediaDir, yoonSoundMediaName(kana)), mp3);
  }
  return { written: missing.length, kept: YOON.length - missing.length };
}

/** Git's object id for a file's content — what a GitHub tree lists for it. */
const gitBlobSha = (buf) => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");

/**
 * The example words' recordings (v87), levelled, as `example-<hash>.mp3`.
 *
 * Lingua Libre's come as Wikimedia's MP3 transcode of the Commons original,
 * after Commons confirms the original's sha1 and that its uploader is the
 * speaker the file is named for. Tofugu's come from the pinned commit, and
 * their bytes have to hash to the pinned blob. Either way a different file
 * stops the import: the gain steps were measured on these. A file already on
 * disk is left alone.
 */
async function writeExampleSounds(mediaDir) {
  mkdirSync(mediaDir, { recursive: true });
  const missing = EXAMPLE_SOUNDS.filter((s) => !existsSync(join(mediaDir, exampleSoundName(s))));
  const commons = missing.filter((s) => s.source === "lingualibre");
  const info = new Map();
  for (let i = 0; i < commons.length; i += 50) {
    const titles = commons.slice(i, i + 50).map((s) => `File:${s.file}`);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=sha1|url|user&titles=${encodeURIComponent(titles.join("|"))}`;
    const res = await politeFetch(url);
    if (!res.ok) throw new Error(`Wikimedia Commons: HTTP ${res.status} (${url})`);
    const { query } = await res.json();
    const asked = new Map((query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of query.pages) info.set(asked.get(page.title) ?? page.title, page.imageinfo?.[0]);
  }
  for (const [n, sound] of missing.entries()) {
    let url;
    if (sound.source === "lingualibre") {
      const found = info.get(`File:${sound.file}`);
      if (!found) throw new Error(`Wikimedia Commons has no File:${sound.file} (${sound.reading})`);
      if (found.sha1 !== sound.hash || found.user !== sound.speaker) {
        throw new Error(
          `File:${sound.file} is not the recording pinned in lib/example-sounds.js: sha1 ${found.sha1}, uploaded by ${found.user}`,
        );
      }
      const [h, hh, name] = new URL(found.url).pathname.split("/").slice(-3);
      url = `https://upload.wikimedia.org/wikipedia/commons/transcoded/${h}/${hh}/${name}/${name}.mp3`;
    } else {
      url = `https://raw.githubusercontent.com/tofugu/japanese-vocabulary-pronunciation-audio/${TOFUGU_COMMIT}/${sound.file.split("/").map(encodeURIComponent).join("/")}`;
    }
    if (n > 0 && sound.source === "lingualibre") await sleep(2000);
    const res = await politeFetch(url);
    if (!res.ok) throw new Error(`${sound.reading}: HTTP ${res.status} (${url})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sound.source === "tofugu" && gitBlobSha(buf) !== sound.hash) {
      throw new Error(`${sound.file} at ${TOFUGU_COMMIT} is not the recording pinned in lib/example-sounds.js`);
    }
    writeFileSync(join(mediaDir, exampleSoundName(sound)), withGain(buf, sound.steps));
  }
  return { written: missing.length, kept: EXAMPLE_SOUNDS.length - missing.length };
}

/**
 * The 92 generated example-word recordings (#183, gap (a)): the same local
 * VOICEVOX as the yōon, one utterance per word, its accent forced to the
 * pitch `lib/generated-example-sounds.js` pins — not VOICEVOX's own guess.
 * Generated once, then left alone, like the yōon and the Commons recordings.
 */
async function writeGeneratedExampleSounds(mediaDir, voicevoxUrl) {
  mkdirSync(mediaDir, { recursive: true });
  const missing = GENERATED_EXAMPLE_SOUNDS.filter((s) => !existsSync(join(mediaDir, generatedExampleSoundName(s))));
  for (const sound of missing) {
    let wav;
    try {
      const query = await generatedAudioQuery(sound, voicevoxUrl);
      wav = await generatedSynthesize(query, voicevoxUrl);
    } catch (err) {
      throw new Error(
        `VOICEVOX at ${voicevoxUrl} is unreachable, needed for ${sound.reading}. Start it with ` +
          `'docker run -d --rm -p 127.0.0.1:50021:50021 voicevox/voicevox_engine:cpu-ubuntu20.04-latest' ` +
          `and retry, or pass --voicevox. (${err.message})`,
      );
    }
    const steps = gainSteps(activeLevel(parseWav(wav)));
    const mp3 = withGain(
      await encodeMp3(wav, { artist: EXAMPLE_VOICEVOX_CREDIT, comment: "Generated audio, not a human recording (#183)" }),
      steps,
    );
    writeFileSync(join(mediaDir, generatedExampleSoundName(sound)), mp3);
  }
  return { written: missing.length, kept: GENERATED_EXAMPLE_SOUNDS.length - missing.length };
}

/**
 * The kana pictures (v88, #177): copied out of the repository rather than
 * downloaded, because they are crops of one large chart (lib/kana-mnemonics.js
 * says why they are committed). A file already there is left alone, but one
 * whose bytes differ is replaced, so a corrected tile reaches the server.
 */
function writeMnemonics(mediaDir) {
  mkdirSync(mediaDir, { recursive: true });
  const from = new URL("./assets/mnemonics/", import.meta.url);
  let written = 0;
  let kept = 0;
  for (const { kana } of MNEMONICS) {
    const source = readFileSync(new URL(mnemonicAssetName(kana), from));
    const dest = join(mediaDir, mnemonicMediaName(kana));
    if (existsSync(dest) && readFileSync(dest).equals(source)) {
      kept += 1;
      continue;
    }
    writeFileSync(dest, source);
    written += 1;
  }
  return { written, kept };
}

async function writeStrokes(mediaDir) {
  mkdirSync(mediaDir, { recursive: true });
  let written = 0;
  let kept = 0;
  for (const char of strokeCharacters()) {
    const dest = join(mediaDir, strokeMediaName(char));
    if (existsSync(dest)) {
      kept += 1;
      continue;
    }
    const url = `https://raw.githubusercontent.com/KanjiVG/kanjivg/${KANJIVG_RELEASE}/kanji/${strokeFile(char)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`KanjiVG has no ${char} (${url}): HTTP ${res.status}`);
    const svg = await res.text();
    if (!svg.includes("<svg")) throw new Error(`not an SVG: ${url}`);
    writeFileSync(dest, svg);
    written += 1;
  }
  return { written, kept };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = args["data-dir"] ?? process.env.DATA_DIR ?? "./data";
  const dbFile = args.db ?? join(dataDir, "kotoba.sqlite");
  const mediaDir = args.media ?? process.env.MEDIA_DIR ?? "./media";

  const db = openDatabase(dbFile);
  const total = kanaCards().length;
  const voicevoxUrl = args.voicevox ?? process.env.VOICEVOX_URL ?? "http://127.0.0.1:50021";
  let examples;
  if (args["no-examples"]) {
    process.stdout.write("Example words left as they are (--no-examples)\n");
  } else {
    const sources = await loadExampleSources();
    // v87: on disk before any card names them, like the kana sounds below.
    const { written, kept } = await writeExampleSounds(mediaDir);
    process.stdout.write(`Example word recordings (Lingua Libre, Tofugu): ${written} written, ${kept} already there, in ${mediaDir}\n`);
    const generated = await writeGeneratedExampleSounds(mediaDir, voicevoxUrl);
    process.stdout.write(
      `Example word recordings (VOICEVOX:No.7, generated, #183): ${generated.written} written, ${generated.kept} already there, in ${mediaDir}\n`,
    );
    examples = kanaExamples(db, { ...sources, sounds: [...EXAMPLE_SOUNDS, ...GENERATED_EXAMPLE_SOUNDS] });
    for (const deck of ["hiragana", "katakana"]) {
      const cards = kanaCards().filter((c) => c.deck === deck);
      const withOne = cards.filter((c) => examples.get(c.id).length > 0).length;
      const heard = cards.filter((c) => examples.get(c.id).some((e) => e.audio)).length;
      process.stdout.write(`Examples (${deck}): ${withOne} of ${cards.length} cards have one, ${heard} a recorded one\n`);
    }
  }
  let sounds = false;
  if (args["no-sounds"]) {
    process.stdout.write("Kana recordings left as they are (--no-sounds)\n");
  } else {
    const { written, kept } = await writeSounds(mediaDir);
    sounds = true;
    process.stdout.write(`Kana recordings (Wikimedia Commons): ${written} written, ${kept} already there, in ${mediaDir}\n`);
    const yoon = await writeYoonSounds(mediaDir, voicevoxUrl);
    process.stdout.write(`Yōon recordings (VOICEVOX:No.7, generated): ${yoon.written} written, ${yoon.kept} already there, in ${mediaDir}\n`);
  }
  let mnemonics = false;
  if (args["no-mnemonics"]) {
    process.stdout.write("Kana pictures left as they are (--no-mnemonics)\n");
  } else {
    const { written, kept } = writeMnemonics(mediaDir);
    mnemonics = true;
    process.stdout.write(`Kana pictures (B. Domangue, CC BY-SA 4.0): ${written} written, ${kept} already there, in ${mediaDir}\n`);
  }
  const changed = writeKanaCards(db, undefined, examples, { sounds, mnemonics });
  db.close();
  process.stdout.write(`Kana cards: ${total} in ${dbFile}, ${changed} new or changed\n`);

  if (args["no-strokes"]) {
    process.stdout.write("Stroke order skipped (--no-strokes)\n");
  } else {
    const { written, kept } = await writeStrokes(mediaDir);
    process.stdout.write(`Stroke order (KanjiVG ${KANJIVG_RELEASE}): ${written} written, ${kept} already there, in ${mediaDir}\n`);
  }
}
