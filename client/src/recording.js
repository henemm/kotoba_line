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
 * entirely. Each stream's tracks are stopped once its recording is done, so
 * the microphone indicator does not stay lit between cards either.
 */

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
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });
  recorder.start();

  return {
    stop: () =>
      new Promise((resolve, reject) => {
        recorder.addEventListener("error", (e) => {
          for (const track of stream.getTracks()) track.stop();
          reject(e.error);
        });
        recorder.addEventListener("stop", () => {
          for (const track of stream.getTracks()) track.stop();
          resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
        });
        recorder.stop();
      }),
  };
}
