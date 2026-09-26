/**
 * Reading a card aloud.
 *
 * Recorded audio where the deck has it, speech synthesis otherwise — which is
 * what the Settings screen promises and what the personal deck will need, since
 * her own words come with no recordings (§8).
 */
import { note } from "./trace.js";

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
  // Every name here was flat until #183 follow-up's practice/<file> — encoded
  // whole, "/" would become %2F and 404. Each segment is still encoded, a
  // recording's own id included.
  const path = file.split("/").map(encodeURIComponent).join("/");
  return new URL(`media/${path}`, docBase).pathname;
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

/**
 * Download a card's recordings before anyone asks to hear them (#116).
 *
 * Called when a card is drawn, so ♪ plays from the cache instead of starting a
 * download on the tap. Through the service worker this lands in the media
 * cache; without one, nginx marks the files immutable for a year, so the
 * browser's own cache keeps them. The body is read to the end because the
 * browser only keeps a response that was fully received.
 *
 * Deliberately not awaited by `say()`: on iOS, `play()` after an `await` is
 * no longer inside the tap and may be refused. The worker makes the playback
 * request join this download rather than start a second one.
 */
export function prime(...files) {
  if (typeof fetch === "undefined") return;
  for (const file of files) {
    if (!file) continue;
    fetch(mediaUrl(file))
      .then((res) => res.arrayBuffer())
      .catch(() => {}); // offline or a weak signal: the tap will simply try again
  }
}

let current;
// say()'s or playTracked()'s onEnded, so an external stop() (leaving the
// card, another ♪ starting) can tell it its play was interrupted rather
// than finished — otherwise the caller waits forever for an "ended" or
// "error" event that a pause() never fires, stuck showing "playing" (and,
// for a voice circle, its sibling stuck disabled) until the whole card is
// torn down and redrawn.
let currentInterrupted;
// Bumped by every say()/track() call, and read back by that call's own
// "ended"/"error" (or, for speech, onend/onerror) listeners before they act.
// speechSynthesis.cancel() does not reliably skip the cancelled utterance's
// own end/error event — cross-browser, sometimes it still fires — so a
// `say()` that starts a *new* sound right after cancelling an old one can
// otherwise race: the old utterance's stray event arrives after the new
// play has already set up its own `currentInterrupted`, and clears that
// instead of its own, leaving the new sound's caller (a ♪ button's "playing"
// class, since #218) waiting for an end that already happened.
let playToken = 0;

/**
 * What say() is playing right now, for whoever draws it (Henning,
 * 2026-09-19). A ♪ button pulses while its sound runs; until this it did so
 * only when it had been tapped, so a word or sentence the app read aloud by
 * itself played with the button standing still. "Is it talking?" is a state
 * (Nielsen's first heuristic, visibility of system status), and a state does
 * not depend on who started it — only the tap-ring belongs to the tap.
 *
 * `{ text, file }` while a sound runs, undefined otherwise.
 */
let playing;
const playingListeners = new Set();

export const nowPlaying = () => playing;

/** Called with nowPlaying() whenever it changes. Returns the unsubscribe. */
export function onPlayingChange(listener) {
  playingListeners.add(listener);
  return () => playingListeners.delete(listener);
}

function setPlaying(value) {
  playing = value;
  for (const listener of playingListeners) listener(value);
}

/**
 * Play a card's recorded audio, falling back to speech.
 *
 * A card with no audio is not an error — 1 of 1,500 in the current deck has
 * none, and the whole personal deck will have none.
 *
 * `onEnded` is optional and fires exactly once — on completion, on a play
 * failure, or on being interrupted by a `stop()` (leaving the card, another
 * ♪ starting) — the same "one call, whatever happens" contract `track()`
 * gives the voice circles. It is what lets a ♪ button show it is playing for
 * as long as the sound actually runs, recording or synthesis alike, rather
 * than only for the ~80ms the tap itself takes.
 */
export async function say(text, file, { rate = 0.9, onEnded: callerEnded } = {}) {
  stop();
  const token = ++playToken;
  if (!text && !file) {
    callerEnded?.();
    return;
  }
  // Every path below ends in exactly one onEnded (see above), so this is
  // where "playing" ends too. stop() above already ended the previous sound's.
  const sound = { text, file };
  setPlaying(sound);
  const onEnded = () => {
    if (playing === sound) setPlaying(undefined);
    callerEnded?.();
  };

  if (file) {
    try {
      const audio = new Audio(mediaUrl(file));
      current = audio;
      currentInterrupted = () => {
        currentInterrupted = undefined;
        onEnded?.();
      };
      audio.addEventListener("ended", () => {
        if (token !== playToken) return;
        currentInterrupted = undefined;
        onEnded?.();
      });
      // Same reasoning as track()'s: a 404 or corrupt file does not reliably
      // reject play()'s own promise — the two can also both fire for one
      // failure, which is why this checks `token` too.
      audio.addEventListener("error", () => {
        if (token !== playToken) return;
        currentInterrupted = undefined;
        onEnded?.();
      });
      await audio.play();
      return;
    } catch (err) {
      // A card with no audio is ordinary; a card that *names* a file we cannot
      // play is not, and speech would otherwise hide it forever.
      console.warn(`could not play ${file}, falling back to speech`, err);
      // #299: the one trace a silent recording leaves — the name only. Not
      // an AbortError: that is her next tap cutting the sound short.
      if (err?.name !== "AbortError") note("audio", { r: "speech", e: String(err?.name ?? err).slice(0, 40) });
      current = undefined;
      currentInterrupted = undefined;
    }
  }

  if (typeof speechSynthesis === "undefined" || !text) {
    onEnded?.();
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  if (japaneseVoice) u.voice = japaneseVoice;
  u.rate = rate;
  currentInterrupted = () => {
    currentInterrupted = undefined;
    onEnded?.();
  };
  u.onend = () => {
    if (token !== playToken) return;
    currentInterrupted = undefined;
    onEnded?.();
  };
  u.onerror = () => {
    if (token !== playToken) return;
    currentInterrupted = undefined;
    onEnded?.();
  };
  speechSynthesis.speak(u);
}

export function stop() {
  playToken++;
  if (current) {
    current.pause();
    current = undefined;
  }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  // Outside the `if (current)` above on purpose: a speech-synthesis-only
  // play (no `Audio` element, so `current` was never set) still needs its
  // caller told it was cut short, the same as a recording does.
  currentInterrupted?.();
  currentInterrupted = undefined;
}

/**
 * Play one recording with progress as it goes (#185's voice circles, whose
 * ring fills at the pace of the recording itself, not a guessed duration).
 * Assigned to the same `current` as `say()`, so leaving the card still stops
 * it. `onProgress` gets 0..1; `onEnded` fires once, on completion or on a
 * failure to play (a card with no audio is ordinary elsewhere, but a voice
 * circle only calls this once it already knows a file exists).
 */
export function playTracked(file, options) {
  return track(mediaUrl(file), options, { file });
}

/**
 * The same, for audio that was never a file on the server: her attempt in
 * "Antwort aufnehmen" (#185, 2026-09-17), an object URL that lives only as
 * long as the card on screen (ui/answer-recorder.js).
 */
export function playUrl(url, options) {
  return track(url, options, { url });
}

/**
 * `sound` is what nowPlaying() reports while this runs. Until v144 only say()
 * reported anything, so her own attempt played with its ▶ standing still
 * (Henning, 2026-09-19: "komplett ohne Animation … Warum arbeitest du nicht
 * mit System?") — "is it talking?" was a state of one of the two ways to
 * play a sound, not of sound.
 */
function track(src, { onProgress, onEnded: callerEnded } = {}, sound = { url: src }) {
  stop();
  setPlaying(sound);
  const onEnded = () => {
    if (playing === sound) setPlaying(undefined);
    callerEnded?.();
  };
  const audio = new Audio(src);
  current = audio;
  // Cleared before every call to onEnded, on every path — a stop() that
  // lands after natural completion (or after an error already reported it)
  // must not report the same play as interrupted a second time.
  currentInterrupted = () => {
    currentInterrupted = undefined;
    onEnded?.();
  };
  audio.addEventListener("timeupdate", () => {
    if (audio.duration) onProgress?.(audio.currentTime / audio.duration);
  });
  audio.addEventListener("ended", () => {
    currentInterrupted = undefined;
    onEnded?.();
  });
  // A 404 or a corrupt file does not reliably reject play()'s own promise —
  // it can instead fire only this event, well after play() resolved. The
  // caller's voice circle waits on onEnded to leave its "playing" state, so
  // without this it (and its sibling, which it disables while playing) get
  // stuck until the card is left and re-entered.
  audio.addEventListener("error", () => {
    currentInterrupted = undefined;
    onEnded?.();
  });
  audio.play().catch(() => {
    currentInterrupted = undefined;
    onEnded?.();
  });
}
