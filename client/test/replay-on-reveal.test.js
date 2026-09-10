import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

/**
 * #32 — a revealed card can always be heard again.
 *
 * Reported from the phone against めくる: the ♪ button is on the front of the
 * card and gone from the back, so the one moment she knows what the sentence
 * means is the one moment she cannot replay it. It was not an implementation
 * slip — design screens 41 and 42 draw the revealed card with no speaker at
 * all — but it is wrong for a language app, so the app now deviates.
 *
 * This suite reads the source, which is weaker than driving the screen. The
 * client has no DOM and no dependencies (see the CI comment: "the screens are
 * checked by looking at them"), so what follows is a guard against the button
 * being deleted again, not proof that it works. That proof was a browser:
 * Chromium at 394 × 798, signed in against a real server, one card revealed in
 * each of the four modes —
 *
 *   めくる  front 1 speaker → reveal 2  [word, sentence]
 *   選ぶ    front 0 (no recording, 48)  → reveal 1  [sentence]
 *   聞く    front 1 (the prompt)        → reveal 2  [prompt, sentence]
 *   話す    front 0                     → reveal 1  [sentence]
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "src", "screens", "session.js"), "utf8");
const css = readFileSync(join(__dirname, "..", "src", "ui", "screens.css"), "utf8");

/** The body of a named function declaration, brace-matched. */
function bodyOf(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found in session.js`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe("a revealed card can be heard again (#32)", () => {
  it("gives the revealed sentence its own speaker", () => {
    // Every mode's reveal goes through this one function, which is why the fix
    // is here rather than repeated four times.
    assert.match(bodyOf("revealedSentence"), /speaker\(\s*card\.sentence/);
  });

  it("keeps the word's speaker after めくる flips the card", () => {
    // The front has one; before #32 the flip took it away, which is the shape
    // of the bug as reported.
    assert.match(bodyOf("revealFlip"), /speaker\(\s*card\.word/);
  });

  it("gives 話す a speaker on a card that has no sentence", () => {
    // 話す reveals the sentence when there is one and the bare word when there
    // is not; the second branch is the one that had nothing to play.
    assert.match(bodyOf("revealSpeak"), /speaker\(\s*card\.word/);
  });

  it("styles the reveal's speaker smaller than the prompt's", () => {
    // 44px beside a word set in clamp(44px, 15vw, 76px): a second 62px circle
    // on the reveal competes with the word for the eye.
    const rule = css.match(/\.speaker\.small\s*{[^}]*}/);
    assert.ok(rule, ".speaker.small rule not found");
    assert.match(rule[0], /width:\s*44px/);
    assert.match(rule[0], /height:\s*44px/);
  });

  it("bumps the service worker VERSION so installed phones drop the old shell", () => {
    // Without this the change ships and her phone keeps serving the cached
    // screen, which is indistinguishable from the fix not working.
    const sw = readFileSync(join(__dirname, "..", "sw.js"), "utf8");
    const version = sw.match(/const VERSION = "([^"]+)"/);
    assert.ok(version, "VERSION constant not found in sw.js");
    assert.notEqual(version[1], "v7", "VERSION still reads v7 — bump it with this change");
  });
});
