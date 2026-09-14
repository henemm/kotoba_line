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

  it("keeps a swipe inside the tab", () => {
    const rule = css.slice(css.indexOf("\n.practise {"), css.indexOf("}", css.indexOf("\n.practise {")));
    assert.match(rule, /overscroll-behavior: contain/);
  });
});
