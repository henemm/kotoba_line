import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

/**
 * #118 — the practise tab keeps its scroll position through a sync.
 *
 * Reads the source, because the client has no DOM here. The proof was WebKit
 * at 402 × 874 (safe area 62/34, standalone rules on) against the live API,
 * with the Carry-on card showing, one review waiting and the upload held for
 * 1.5 s, scrolled to the bottom before it landed (2026-09-14):
 *
 *   v47  scrolled 107 of 107 → the sync rebuilt the tab → 0; the Synced
 *        strip clearing 2 s later rebuilt it again → 0 of 74
 *   v48  scrolled 107 of 107 → the sync rebuilt the tab → still 107; the
 *        strip clearing swapped only the strip → 74 of 74 (the room it left)
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dirname, "..", "src", "app.js"), "utf8");
const practise = readFileSync(join(__dirname, "..", "src", "screens", "practise.js"), "utf8");
const css = readFileSync(join(__dirname, "..", "src", "ui", "screens.css"), "utf8");

describe("the practise tab keeps its place (#118)", () => {
  it("swaps only the strip when the Synced message clears", () => {
    const timer = app.slice(app.indexOf("clearBarTimer = setTimeout("));
    const body = timer.slice(0, timer.indexOf("}, 2000)"));
    assert.match(body, /if \(!replaceOfflineBar\(\)\) renderApp\(\)/);
  });

  it("hands a rebuilt tab the old tab's scroll position, and restores it", () => {
    assert.match(app, /scrollTop: app\.querySelector\(":scope > \.practise"\)\?\.scrollTop/);
    assert.match(practise, /if \(scrollTop\) root\.scrollTop = scrollTop;/);
  });

});

/**
 * #123 — the practise tab is short enough not to need scrolling at all.
 *
 * v48 kept the scroll position, and on Henning's iPhone the tab still took
 * one swipe and then stuck; the device reported `moved 0 of 0`. What settled
 * it was the layout rather than the scroller: "Find and star words" and "Add
 * a word" moved to a Words tab, and session length is set on this tab only.
 */
const settings = readFileSync(join(__dirname, "..", "src", "screens", "settings.js"), "utf8");
const browse = readFileSync(join(__dirname, "..", "src", "screens", "browse.js"), "utf8");

describe("the Words tab (#123)", () => {
  it("is a tab, between Practise and Stats", () => {
    const tabs = app.slice(app.indexOf("const TABS = ["), app.indexOf("];", app.indexOf("const TABS = [")));
    assert.deepEqual([...tabs.matchAll(/key: "(\w+)"/g)].map((m) => m[1]), ["practise", "words", "stats", "settings"]);
  });

  it("takes search and her own words off the practise tab", () => {
    assert.doesNotMatch(practise, /button\.add-word-row|onAddWord|onBrowse|onOwnDeck/);
    assert.match(browse, /"Add a word"/);
  });

  it("leaves session length to the practise tab alone", () => {
    assert.doesNotMatch(settings, /Session length|sessionLength/);
    assert.match(practise, /SESSION_LENGTHS/);
  });

  // Reads the source. Moving the picker here lost the "Session length" label
  // it had in Settings, and three bare buttons told nobody what they were for.
  // The browser run for v51 measured the label at 394 × 852 with the Carry-on
  // card showing: the tab still does not scroll, last element 716, fade 740.
  it("gives the session length buttons a heading", () => {
    assert.match(practise, /"aria-labelledby": "length-label"/);
    assert.match(practise, /id: "length-label", text: "How many cards"/);
  });

  it("drops the #118 workarounds that rested on a disproven theory", () => {
    assert.doesNotMatch(css, /overscroll-behavior: contain/);
    const viewport = readFileSync(join(__dirname, "..", "src", "viewport.js"), "utf8");
    assert.doesNotMatch(viewport, /watchList|"List"|"Scroll"/);
  });
});
