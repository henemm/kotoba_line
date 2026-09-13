import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

/**
 * #116 — ♪ shows that the tap arrived, and a card's sound is already loaded.
 *
 * This suite reads the source: the client has no DOM here. It guards against
 * the pieces being taken out again; the proof was WebKit at 394 × 852 against
 * the live API and the live deck's audio, with 300ms added to every media
 * response to stand in for the round trip from Tokyo (2026-09-13):
 *
 *   tap on ♪, read-aloud off     v46 344 ms, one download on the tap
 *                                v47 126 ms, no download on the tap
 *   tap on ♪, read-aloud on      23 ms in both (read-aloud had loaded it)
 *   a card drawn, read-aloud on  v47 without the worker sharing downloads:
 *                                3 requests (the word twice); with it: 2
 *   120ms after touch-down       class `tapped`, ghost speaker in the line's
 *                                colour, ring 5–6px out at opacity ~0.55;
 *                                class gone again 1s later
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, "..", ...p), "utf8");
const session = read("src", "screens", "session.js");
const audio = read("src", "audio.js");
const sw = read("sw.js");
const css = read("src", "ui", "screens.css");

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe("♪ acknowledges the tap and plays from the cache (#116)", () => {
  it("routes every session speaker through acknowledged()", () => {
    assert.match(bodyOf(session, "speaker"), /\.\.\.acknowledged\(/);
  });

  it("draws the ring from the class acknowledged() sets", () => {
    assert.match(css, /\.speaker\.tapped::after[\s\S]*?animation:\s*tap-ring/);
  });

  it("starts a drawn card's recordings downloading", () => {
    assert.match(bodyOf(session, "drawCard"), /prime\(card\.word_audio, card\.sentence_audio\)/);
  });

  it("never makes say() wait before play()", () => {
    // On iOS a play() after an await has left the tap and may be refused.
    const body = bodyOf(audio, "say");
    const play = body.indexOf("await audio.play()");
    assert.ok(play > -1);
    assert.equal(body.slice(0, play).includes("await"), false);
  });

  it("lets a playback request join a download already under way", () => {
    // Registered synchronously, before anything is awaited, or two requests
    // arriving together both miss: so the function itself must not be async.
    assert.match(sw, /\nfunction wholeFile\(/);
    assert.doesNotMatch(sw, /async function wholeFile\(/);
    assert.match(bodyOf(sw, "wholeFile"), /inflight\.get\(url\)[\s\S]*inflight\.set\(url, pending\)/);
  });
});
