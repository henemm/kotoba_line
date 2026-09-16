/**
 * Recording her own or a native speaker's pronunciation of a card (#183
 * follow-up) — `MediaRecorder`, not `webkitSpeechRecognition`. The two are
 * unrelated APIs: the latter crashed the installed app on her iPad and was
 * removed outright (#155, session.js's drawSpeak). `MediaRecorder` was
 * checked separately, on the real device, before any of this was written.
 *
 * `getUserMedia` is asked fresh for every recording, not once and reused —
 * measured on the deployed server, 2026-09-16: reusing one `MediaStream`
 * across several `MediaRecorder`s produced a first recording ffmpeg could
 * read and every later one it rejected outright ("Invalid data found when
 * processing input"), a known WebKit quirk with a stream a recorder has
 * already been attached to. `getUserMedia`'s permission prompt does not
 * re-ask within one page load (only across a fresh load, a separate iOS
 * limitation, not fixable here), so asking again per recording costs
 * nothing — no second prompt, and it sidesteps the corrupted-data case
 * entirely.
 *
 * Releasing the tracks is not only `stop()`'s job (Charlotte, 2026-09-16:
 * the mic indicator stayed lit after a finished recording). A caller that
 * never calls `stop()` — she rates the card and moves on while "Stopp" is
 * still showing — used to leave that stream's track running forever, since
 * nothing else held a reference to it. `startRecording` now keeps the one
 * live capture in module state and releases it (a) itself, before opening
 * a new one, and (b) release listeners are attached at creation, not only
 * inside `stop()`, so a recorder that dies on its own — an iOS interruption,
 * the PWA backgrounded — also lets go. `stopAllRecording` is what a screen
 * calls when it is no longer showing the card that started a recording.
 */

let active = null;

function release(entry) {
  if (!entry) return;
  for (const track of entry.stream.getTracks()) track.stop();
}

/**
 * Stops whatever recording is in progress, wherever it was started. Call
 * this when leaving the screen or the card a recording belongs to — the
 * only way to free a stream a caller lost track of without ever calling the
 * `stop()` it was handed.
 */
export function stopAllRecording() {
  release(active);
  active = null;
}

/** Whether this device can record at all — checked once, not assumed. */
export function canRecord() {
  return typeof MediaRecorder !== "undefined" && typeof navigator?.mediaDevices?.getUserMedia === "function";
}

/**
 * Safari before 18.4 only produces audio/mp4 (AAC); everything else prefers
 * webm/opus. Checked in order rather than assumed, the same as the test page
 * that was tried on the iPad.
 */
function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mp4;codecs=mp4a.40.2", "audio/aac"];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return "";
}

/**
 * Starts recording and returns `{ stop }`; `stop()` resolves to the finished
 * Blob. Throws (`NotAllowedError` refused, `NotFoundError` no microphone) if
 * the stream cannot be opened — callers show that as a plain sentence, not a
 * broken control, the same "absent rather than inert" rule the rest of the
 * app's audio follows.
 */
export async function startRecording() {
  stopAllRecording(); // never more than one live capture — the previous owner lost its reference
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const entry = { stream };
  active = entry;
  const chunks = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });
  // Release on every way a recorder can end, not only the `stop()` below —
  // that is what still lets go when nobody ever calls it.
  const releaseEntry = () => {
    if (active === entry) active = null;
    release(entry);
  };
  recorder.addEventListener("error", releaseEntry);
  recorder.addEventListener("stop", releaseEntry);
  recorder.start();

  return {
    stop: () =>
      new Promise((resolve, reject) => {
        recorder.addEventListener("error", (e) => reject(e.error));
        recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" })));
        recorder.stop();
      }),
  };
}
