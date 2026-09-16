/**
 * WAV → MP3, for the one case in this project that needs it: VOICEVOX
 * (#183) returns WAV, and everything else here — playback, `mp3gain.js`'s
 * bit-level leveling, iOS's Range requests — is built on MPEG-1 Layer III.
 *
 * `import/` otherwise has no dependencies of its own (the zip reader in
 * `lib/zip.js` exists so an `unzip` binary is not needed either), but
 * hand-writing an MP3 encoder is a different order of work than parsing a
 * zip's central directory, so this shells out to `ffmpeg` — a system tool,
 * not an npm package, installed once on the server for this.
 */

import { spawn } from "node:child_process";

/** `wav` encoded to mono 44.1 kHz MP3 (CBR-ish VBR quality 4), no CRC — what `mp3gain.js` requires. */
export function encodeMp3(wav) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-i", "pipe:0",
      "-codec:a", "libmp3lame",
      "-qscale:a", "4",
      "-ar", "44100",
      "-ac", "1",
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
    ffmpeg.stdin.end(wav);
  });
}
