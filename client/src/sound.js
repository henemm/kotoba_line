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
 * added, then a generated file — the deck's (kana) or one
 * import/generate-word-sounds.js made for a word with no recording (#183,
 * v118: "überall Computer-Audio"). `deckNative` is the one case nothing can
 * be added to. `unchecked` is the asterisk: a generated accent no second
 * source has confirmed (`word_audio_checked`).
 */
export function wordSound(card, recording) {
  const deck = card?.word_audio ?? null;
  const none = { deckNative: false, recording: null, unchecked: false };
  if (deck && !isGeneratedAudio(deck)) return { ...none, file: deck, source: "native", deckNative: true };
  if (recording?.file) return { ...none, file: recording.file, source: "native", recording };
  if (deck) return { ...none, file: deck, source: "synth" };
  const generated = card?.word_audio_generated ?? null;
  if (generated) return { ...none, file: generated, source: "synth", unchecked: card.word_audio_checked !== 1 };
  return { ...none, file: null, source: "none" };
}
