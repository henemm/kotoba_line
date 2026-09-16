/**
 * Generated audio for the 33 yōon (きゃ …, #183): no free human recording of
 * them exists (`kana-sounds.js` has the 71 that do), and until now the
 * phone's voice read them live, with a caption saying so.
 *
 * Why a generated *recording* is defensible here where it is not for a whole
 * word (#183's research): a single mora has no pitch accent to get wrong —
 * accent is what Japanese TTS still fails at, and it is invisible on one
 * mora, audible from the second mora on. Generating once, here, on a Mac- or
 * Linux-class machine with a real voice, and listening to every clip before
 * it ships, beats the phone guessing live with whatever compact voice iOS
 * hands the web API that day.
 *
 * The voice: VOICEVOX (voicevox.hiroshiba.jp), speaker "No.7", the "アナウンス"
 * (announcer) style — id 30, chosen for being read plainly rather than acted,
 * which is what a pronunciation reference wants. Its terms require the
 * credit "VOICEVOX:No.7" for non-commercial use, on Settings → Quellen.
 *
 * Unlike the Commons recordings, this is not an external resource that can
 * drift — the engine runs locally and the text is fixed — so there is
 * nothing to pin a hash against. `import-kana.js`'s own rule still applies:
 * a file already on disk is left alone, so a re-run never regenerates one.
 */

import { YOON, toHiragana } from "./kana.js";

export const VOICEVOX_SPEAKER = 30; // No.7, アナウンス
export const VOICEVOX_CREDIT = "VOICEVOX:No.7";

/** Said three times, like the human recordings, with a pause close to their ~1 s. */
export const REPETITIONS = 3;
export const PAUSE_LENGTH_SCALE = 2.2;

/**
 * Where a yōon's recording is written: both characters' code points, unlike
 * the single-character `soundMediaName` in `kana-sounds.js` — きゃ, きゅ and
 * きょ share き's code point and would collide on one. Still hiragana, still
 * the `kana-` prefix sw.js recognises, so きゃ and キャ share one file.
 */
export function yoonSoundMediaName(kana) {
  const codes = [...toHiragana(kana)].map((c) => c.codePointAt(0).toString(16).padStart(5, "0"));
  return `kana-${codes.join("-")}.mp3`;
}

const files = new Map(YOON.map(([kana]) => [kana, yoonSoundMediaName(kana)]));

/** A yōon's recording, or null for anything that is not one of the 33. */
export function yoonSoundFile(kana) {
  return files.get(toHiragana(kana)) ?? null;
}

/** The audio_query VOICEVOX needs: the kana three times, comma-paused, at the pause length above. */
export async function yoonAudioQuery(kana, voicevoxUrl) {
  const text = Array(REPETITIONS).fill(kana).join("、");
  const url = `${voicevoxUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${VOICEVOX_SPEAKER}`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(`VOICEVOX audio_query for ${kana}: HTTP ${res.status} (${url})`);
  const query = await res.json();
  query.pauseLengthScale = PAUSE_LENGTH_SCALE;
  return query;
}

/** The synthesised WAV for an audio_query, as a Buffer. */
export async function yoonSynthesize(query, voicevoxUrl) {
  const url = `${voicevoxUrl}/synthesis?speaker=${VOICEVOX_SPEAKER}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) });
  if (!res.ok) throw new Error(`VOICEVOX synthesis: HTTP ${res.status} (${url})`);
  return Buffer.from(await res.arrayBuffer());
}
