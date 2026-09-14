import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

/**
 * Stars reach the server one way: `setStar` in stars.js.
 *
 * Reads the source, because the client has no DOM here. #83 made
 * `POST /api/stars` require `changedAt`, which only `setStar` sends. The Words
 * tab kept calling `api.star(id, starred)` itself, so every star tapped there
 * came back 400 and was put back. Measured in WebKit against the live server
 * on 2026-09-14: 400 before the fix; after it, 200 on star and on unstar, and
 * the starred filter listed the card.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "..", "src");

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith(".js") ? [join(dir, entry.name)] : [],
  );
}

describe("stars go through setStar", () => {
  it("calls api.star nowhere but stars.js", () => {
    const callers = sources(src)
      .filter((file) => /\bapi\.star\(/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(src.length + 1));
    assert.deepEqual(callers, ["stars.js"]);
  });

  it("stars from the Words tab with setStar", () => {
    const browse = readFileSync(join(src, "screens", "browse.js"), "utf8");
    assert.match(browse, /setStar\(card\.id, wanted\)/);
    assert.doesNotMatch(browse, /Practise starred|browse-foot/);
  });
});
