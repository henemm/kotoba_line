import { nowPlaying, onPlayingChange, say, unlock } from "../audio.js";
import { acknowledged, el } from "./dom.js";

/**
 * Every ♪ in the app (Henning, 2026-09-19, with a screenshot: "keine
 * Animation, wenn ich auf den Kreis mit der Note klicke. Bist du nicht in der
 * Lage, alle Vorkommen zu finden bzw. das am Objekt einheitlich umzusetzen?").
 * The two signals had been built into the session's ♪ only; the card sheets,
 * the kana sheet and the add-a-word form each drew a ♪ of their own and got
 * neither. Now there is one ♪, and the signals belong to it:
 *
 * - the tap-ring (`.tapped`, via `acknowledged()`): "the tap arrived",
 *   ~0.45 s, only on a tap;
 * - the pulse (`.playing`): "it is talking", for exactly as long as the
 *   sound runs, whoever started it — a tap, or the app reading aloud by
 *   itself (Nielsen #1, visibility of system status).
 *
 * A tap while it plays starts it again rather than stopping it (Henning,
 * 2026-09-19): a second tap usually means "did the first one work?".
 *
 * Callers choose only the look (`className`: the session's round .speaker,
 * a sheet's .topics-hear, ...) and what it plays. `sound` is `{ text, file,
 * rate }`, or a function returning one, for a ♪ whose sound can change while
 * it is on screen (a recording made in the same sheet, a sentence being
 * typed). The CSS for both signals is keyed on `.sound`, not on the looks.
 */
export function soundButton({ sound, className = "", label = "Vorlesen", content = "♪" }) {
  const current = typeof sound === "function" ? sound : () => sound;
  const button = el(`button.sound${className}`, {
    type: "button",
    "aria-label": label,
    text: content,
    ...acknowledged(() => {
      const { text, file, rate } = current() ?? {};
      unlock();
      say(text, file, rate ? { rate } : undefined);
    }),
  });
  keys.set(button, () => {
    const s = current() ?? {};
    return soundKey(s.text, s.file);
  });
  // Drawn with the state as it is: the read-aloud of a new card usually starts
  // before the card's buttons exist.
  paint(button, keyOf(nowPlaying()));
  return button;
}

/** Which ♪ a sound belongs to: its recording, or its text when it has none. */
export function soundKey(text, file) {
  return file ? `file:${file}` : text ? `text:${text}` : undefined;
}

const keys = new WeakMap();
const keyOf = (sound) => soundKey(sound?.text, sound?.file);

function paint(button, playingKey) {
  const own = keys.get(button)?.();
  button.classList.toggle("playing", playingKey !== undefined && own === playingKey);
}

// One listener for the whole app: every ♪ on screen whose sound this is.
onPlayingChange((sound) => {
  if (typeof document === "undefined") return;
  const key = keyOf(sound);
  for (const button of document.querySelectorAll("button.sound")) paint(button, key);
});
