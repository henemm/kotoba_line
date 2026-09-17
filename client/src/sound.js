/**
 * What a card's word sounds like, and whose voice that is (#185).
 *
 * Two sources exist, and only two: a native speaker (the deck's recording,
 * or one added on her device) and a generated file (VOICEVOX, #183). Her own
 * voice is never one — ui/answer-recorder.js. Kept apart from session.js so
 * the deck's card menu can ask the same question without importing a screen.
 */

/**
 * A file the import generated rather than recorded (VOICEVOX, #183): named
 * `<kind>-generated-*` since v93, so a human recording and a generated one
 * can never be told apart only by listening.
 */
export function isGeneratedAudio(file) {
  return typeof file === "string" && /(^|\/)[a-z]+-generated-/.test(file);
}

/**
 * What a non-kana word's ♪ plays, and what kind of voice it is (#185): the
 * deck's own native recording first, then a native speaker's recording she
 * added, then a generated file. `deckNative` is the one case nothing can be
 * added to. As of v117 no non-kana card has a generated file (measured: all
 * 66 are kana), so "synth" is the state her own cards would reach if #183
 * ever gives them one.
 */
export function wordSound(card, recording) {
  const deck = card?.word_audio ?? null;
  if (deck && !isGeneratedAudio(deck)) return { file: deck, source: "native", deckNative: true, recording: null };
  if (recording?.file) return { file: recording.file, source: "native", deckNative: false, recording };
  if (deck) return { file: deck, source: "synth", deckNative: false, recording: null };
  return { file: null, source: "none", deckNative: false, recording: null };
}
