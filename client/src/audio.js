/**
 * Reading a card aloud.
 *
 * Recorded audio where the deck has it, speech synthesis otherwise — which is
 * what the Settings screen promises and what the personal deck will need, since
 * her own words come with no recordings (§8).
 */
/**
 * Where nginx serves the deck's audio (§9: `location /kotoba/media/`).
 *
 * Relative to the app, not above it. `../media/` resolves to `/media/` when the
 * app is served from `/kotoba/`, which 404s every file — and because a card
 * without audio is a normal thing, the fallback to speech synthesis would have
 * hidden it completely. Exported so the resolution is asserted rather than
 * assumed.
 */
export function mediaUrl(file, base) {
  const docBase =
    base ?? (typeof document !== "undefined" ? document.baseURI : "http://localhost/kotoba/");
  return new URL(`media/${encodeURIComponent(file)}`, docBase).pathname;
}

let unlocked = false;
let japaneseVoice = null;

function pickVoice() {
  const all = speechSynthesis.getVoices();
  japaneseVoice =
    all.find((v) => v.lang === "ja-JP") ?? all.find((v) => v.lang.startsWith("ja")) ?? null;
}

if (typeof speechSynthesis !== "undefined") {
  pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

/**
 * §7: iOS produces no sound from speech synthesis until a user gesture has
 * happened. A silent utterance on the first tap of the session buys the rest
 * of it.
 */
export function unlock() {
  if (unlocked || typeof speechSynthesis === "undefined") return;
  const u = new SpeechSynthesisUtterance("");
  u.volume = 0;
  speechSynthesis.speak(u);
  unlocked = true;
}

let current;

/**
 * Play a card's recorded audio, falling back to speech.
 *
 * A card with no audio is not an error — 1 of 1,500 in the current deck has
 * none, and the whole personal deck will have none.
 */
export async function say(text, file, { rate = 0.9 } = {}) {
  stop();
  if (!text && !file) return;

  if (file) {
    try {
      const audio = new Audio(mediaUrl(file));
      current = audio;
      await audio.play();
      return;
    } catch (err) {
      // A card with no audio is ordinary; a card that *names* a file we cannot
      // play is not, and speech would otherwise hide it forever.
      console.warn(`could not play ${file}, falling back to speech`, err);
    }
  }

  if (typeof speechSynthesis === "undefined" || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  if (japaneseVoice) u.voice = japaneseVoice;
  u.rate = rate;
  speechSynthesis.speak(u);
}

export function stop() {
  if (current) {
    current.pause();
    current = undefined;
  }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
