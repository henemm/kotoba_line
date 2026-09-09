/**
 * Reading a card aloud.
 *
 * Recorded audio where the deck has it, speech synthesis otherwise — which is
 * what the Settings screen promises and what the personal deck will need, since
 * her own words come with no recordings (§8).
 */
// Guarded so the module can be imported by a test runner with no DOM.
const MEDIA = new URL(
  "../media/",
  typeof document !== "undefined" ? document.baseURI : "http://localhost/kotoba/",
).pathname;

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
      const audio = new Audio(MEDIA + encodeURIComponent(file));
      current = audio;
      await audio.play();
      return;
    } catch {
      // The file is missing or the browser refused it; speech still works.
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
