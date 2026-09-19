import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Every ♪ is ui/sound-button.js (Henning, 2026-09-19). The tap-ring and the
 * pulse had been built into the session's ♪ only, and four other ♪ drew
 * their own button and got neither — found by him, in a card sheet.
 *
 * This reads the SOURCE, not a DOM (there is none in these tests): it fails
 * when a file other than sound-button.js puts a bare ♪ on a button. The
 * browser run that went with it (WebKit 394x852, live API) measured the
 * pulse on the own-deck sheet, the Kaishi sheet from Suche, the kana sheet,
 * the form's Kaishi offer and the session's ♪.
 */
const SRC = new URL("../src/", import.meta.url).pathname;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".js") ? [path] : [];
  });
}

describe("one ♪ for the whole app", () => {
  it("no file but sound-button.js draws a ♪ button of its own", () => {
    const offenders = files(SRC)
      .filter((f) => !f.endsWith("ui/sound-button.js") && !f.endsWith("ui/voice-circle.js"))
      .filter((f) => /text:\s*"♪/.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders.map((f) => f.slice(SRC.length)), []);
  });
});
