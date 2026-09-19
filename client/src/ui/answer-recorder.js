import { playUrl, stop } from "../audio.js";
import { canRecord, micErrorMessage, startRecording } from "../recording.js";
import { el } from "./dom.js";
import { followsSound, soundButton } from "./sound-button.js";

/**
 * "Antwort aufnehmen" (#185, 2026-09-17): she says the answer before she
 * sees it, and hears herself back next to the real thing once she has.
 *
 * Nothing here leaves the device. Her voice is never a source of how a word
 * sounds — only a generated file or a native speaker is — so the attempt is
 * an object URL held in `attempt` and nowhere else: no upload, no row, no
 * file. That is also why there is no "Wirklich löschen?": nothing can be
 * lost, and recording again simply replaces it.
 *
 * Lifetime, decided against the agreed layout (the artifact's panel 2 and
 * the issue's "fehlt die 'Deine Antwort'-Zeile auf der Rückseite komplett"):
 * the *button* is front-only, the *attempt* survives the flip — comparing
 * the two is the whole point of turning the card — and it is gone at the
 * next card, where session.js's drawCard() revokes the URL.
 *
 * `attempt` is a `{ url }` holder the session owns, because `render()`
 * replaces the DOM this lives in when the card turns. Absent, not inert, on
 * a device that cannot record at all — the same rule as every ♪ in the app.
 */
export function answerRecorder(attempt) {
  if (!canRecord()) return null;

  // v144: the pulse of every ♪ (ui/sound-button.js) for as long as her
  // attempt plays — it had none, a ▶ that stood still while she listened.
  // The tap-ring is every button's (ui/press.js).
  const dial = el("button.answer-dial", { type: "button", onclick: onTap });
  followsSound(dial, () => (attempt.url && (state === "recorded" || state === "playing") ? { url: attempt.url } : undefined));
  const caption = el("span.answer-caption");
  const again = el("button.answer-again", { type: "button", text: "Neu aufnehmen", onclick: onStart });
  const status = el("span.answer-status", { "aria-live": "polite" });
  const root = el("div.answer-recorder", {}, dial, caption, again, status);

  let controller = null;
  // empty | starting | recording | saving | recorded | playing
  let state = attempt.url ? "recorded" : "empty";

  function paint() {
    root.dataset.state = state;
    dial.disabled = state === "starting" || state === "saving";
    const face = {
      empty: ["●", "Antwort aufnehmen"],
      starting: ["●", "Antwort aufnehmen"],
      recording: ["■", "Aufnahme beenden"],
      saving: ["■", "Aufnahme beenden"],
      recorded: ["▶", "Deine Antwort anhören"],
      playing: ["▶", "Deine Antwort anhören"],
    }[state];
    dial.textContent = face[0];
    dial.setAttribute("aria-label", face[1]);
    caption.textContent = face[1];
    again.hidden = state !== "recorded" && state !== "playing";
  }

  function onTap() {
    if (state === "empty") return onStart();
    if (state === "recording") return finish();
    if (state === "recorded" || state === "playing") return onPlay();
  }

  async function onStart() {
    if (state === "starting" || state === "recording" || state === "saving") return;
    stop();
    status.textContent = "";
    state = "starting";
    paint();
    try {
      controller = await startRecording();
      state = "recording";
    } catch (err) {
      controller = null;
      state = attempt.url ? "recorded" : "empty";
      status.textContent = micErrorMessage(err);
    }
    paint();
  }

  /** Ends a running capture and keeps it; resolves at once when none runs. */
  async function finish() {
    if (state !== "recording" || !controller) return;
    state = "saving";
    paint();
    const running = controller;
    controller = null;
    try {
      const blob = await running.stop();
      if (blob.size > 0) {
        if (attempt.url) URL.revokeObjectURL(attempt.url);
        attempt.url = URL.createObjectURL(blob);
      }
    } catch {
      status.textContent = "Die Aufnahme hat nicht geklappt.";
    }
    state = attempt.url ? "recorded" : "empty";
    paint();
  }

  function onPlay() {
    state = "playing";
    paint();
    playUrl(attempt.url, {
      onEnded: () => {
        if (state === "playing") state = "recorded";
        paint();
      },
    });
  }

  paint();
  return { root, finish, recording: () => state === "recording" };
}

/**
 * Her attempt on the side that shows the answer, beside the ♪ it is there to
 * be compared with. Null when she recorded nothing: the row is absent, not a
 * disabled button (#185).
 */
export function attemptRow(attempt) {
  if (!attempt?.url) return null;
  // The app's one ♪ (v144), so it taps and pulses like the ♪ beside it.
  const btn = soundButton({
    sound: { url: attempt.url },
    className: ".attempt-play",
    label: "Deine Antwort anhören",
    content: "▶",
  });
  return el("div.attempt-row.reveal", {}, btn, el("span", { text: "Deine Antwort" }));
}
