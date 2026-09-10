import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(__dirname, "..");

/**
 * The precache list is hand-written and drifted once (#53): six features were
 * added, each with a file, and none of them added a line. That is invisible in
 * ordinary use — the first page load is not yet controlled by the worker, so
 * its module requests bypass the fetch handler entirely, and every *later*
 * online launch fills the missing files in through the `shell()` fallback. It
 * only shows on a cold start with no network, where it is total: app.js
 * imports every one of them statically, so a single missing module leaves a
 * blank screen rather than one absent feature.
 *
 * Reading the source rather than driving a browser is deliberate. The browser
 * run that found this is in the issue; what a unit test can do cheaply, on
 * every commit, is notice the next file that is added without a line here.
 */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("the service worker precaches the whole shell (#53)", () => {
  const sw = readFileSync(join(clientRoot, "sw.js"), "utf8");

  const listed = new Set(
    (sw.match(/const SHELL_FILES = \[([\s\S]*?)\]/)?.[1] ?? "")
      .split("\n")
      .map((line) => line.match(/^\s*"([^"]*)",\s*$/)?.[1])
      .filter((f) => f != null),
  );

  it("finds the list at all", () => {
    assert.ok(listed.size > 0, "SHELL_FILES could not be parsed out of sw.js");
  });

  it("names every module and stylesheet under src/", () => {
    const onDisk = walk(join(clientRoot, "src"))
      .map((p) => relative(clientRoot, p))
      .filter((p) => p.endsWith(".js") || p.endsWith(".css"))
      .sort();

    const missing = onDisk.filter((p) => !listed.has(p));
    assert.deepEqual(
      missing,
      [],
      `these are served to the app but never precached, so a cold start offline ` +
        `has no copy of them: ${missing.join(", ")}`,
    );
  });

  it("lists nothing that is not there, which would fail the install fetch", () => {
    const onDisk = new Set(walk(clientRoot).map((p) => relative(clientRoot, p)));
    const phantom = [...listed].filter(
      (f) => f !== "" && !onDisk.has(f) && !f.startsWith("assets/"),
    );
    assert.deepEqual(phantom, [], `listed in SHELL_FILES but not on disk: ${phantom.join(", ")}`);
  });
});
