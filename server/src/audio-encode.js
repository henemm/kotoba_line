/**
 * Whatever `MediaRecorder` handed the browser (audio/webm;codecs=opus, or
 * audio/mp4 on Safari before 18.4) → MP3, so a recording plays back the same
 * way regardless of which device made it — a friend recording on Android and
 * Charlotte listening on her iPad is exactly the case this exists for.
 *
 * A copy of `import/lib/encode-mp3.js` (#183), not an import from it:
 * `server/` and `import/` are deliberately separate dependency trees (see
 * CLAUDE.md's shape-of-things table), and this is a 30-line wrapper around a
 * system tool, not a module worth threading a path between them for. ffmpeg
 * auto-detects the input container, so the same call works for WAV (#183's
 * use) and for webm/mp4 (this one) alike.
 */

import { spawn } from "node:child_process";

/** `audio` (any container ffmpeg can read) encoded to mono 44.1 kHz MP3, no CRC — what `mp3gain.js`-style tools expect. */
export function encodeMp3(audio, metadata = {}) {
  return new Promise((resolve, reject) => {
    const metaArgs = Object.entries(metadata).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]);
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-i", "pipe:0",
      "-codec:a", "libmp3lame",
      "-qscale:a", "4",
      "-ar", "44100",
      "-ac", "1",
      ...metaArgs,
      "-f", "mp3",
      "pipe:1",
    ]);
    const chunks = [];
    let stderr = "";
    ffmpeg.stdout.on("data", (c) => chunks.push(c));
    ffmpeg.stderr.on("data", (c) => (stderr += c));
    ffmpeg.on("error", (err) => reject(new Error(`ffmpeg not available: ${err.message}`)));
    ffmpeg.on("close", (code) => {
      if (code !== 0) reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
      else resolve(Buffer.concat(chunks));
    });
    ffmpeg.stdin.end(audio);
  });
}
