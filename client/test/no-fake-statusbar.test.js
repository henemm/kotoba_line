import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import * as dom from "../src/ui/dom.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(__dirname, "..");

function read(relPath) {
  return readFileSync(join(clientRoot, relPath), "utf8");
}

describe("no fake status bar (docs/specs/client/remove-fake-statusbar.md)", () => {
  it("does not export statusBar from dom.js", () => {
    assert.equal("statusBar" in dom, false);
  });

  it("leaves no statusBar reference or literal 9:41 in the source", () => {
    for (const path of [
      "src/ui/dom.js",
      "src/app.js",
      "src/screens/signin.js",
      "src/screens/practise.js",
    ]) {
      const text = read(path);
      assert.equal(text.includes("statusBar"), false, `${path} still mentions statusBar`);
      assert.equal(text.includes("9:41"), false, `${path} still contains the literal 9:41`);
    }
  });

  it("replaces the fake bar with a safe-area padding on #app", () => {
    const css = read("src/ui/base.css");
    assert.equal(/\.statusbar\b/.test(css), false, "base.css still has a .statusbar rule");

    const appRule = css.match(/#app\s*{[^}]*}/);
    assert.ok(appRule, "#app rule not found in base.css");
    assert.match(appRule[0], /padding-top:\s*env\(safe-area-inset-top/);
  });

  it("bumps the service worker VERSION so installed devices drop the cached fake bar", () => {
    const sw = read("sw.js");
    const match = sw.match(/const VERSION = "([^"]+)"/);
    assert.ok(match, "VERSION constant not found in sw.js");
    assert.notEqual(match[1], "v1");
  });
});
