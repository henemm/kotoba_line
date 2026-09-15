import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { SUMMARIES_SHOWN, notesSince, sheetSummary, startingPoint, versionNumber } from "../src/whats-new.js";

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const changelog = JSON.parse(readFileSync(join(clientRoot, "changelog.json"), "utf8"));
const swVersion = readFileSync(join(clientRoot, "sw.js"), "utf8").match(/const VERSION = "([^"]+)"/)?.[1];

const log = [
  { version: "v36", summary: "a", notes: [] },
  { version: "v38", summary: "c", notes: [] },
  { version: "v37", summary: "b", notes: [] },
];

describe("what changed between two shells (#93)", () => {
  it("reads vN as a number, and anything else as no version", () => {
    assert.equal(versionNumber("v36"), 36);
    assert.equal(versionNumber("v9") < versionNumber("v10"), true, "not a string comparison");
    assert.ok(Number.isNaN(versionNumber(undefined)));
    assert.ok(Number.isNaN(versionNumber("36")));
  });

  it("lists every version she skipped, newest first, and not the one she has", () => {
    assert.deepEqual(
      notesSince(log, "v36", "v38").map((e) => e.version),
      ["v38", "v37"],
    );
  });

  it("stops at the version that is waiting, even when the log knows a newer one", () => {
    assert.deepEqual(notesSince(log, "v35", "v37").map((e) => e.version), ["v37", "v36"]);
  });

  it("gives nothing for a changelog that could not be read", () => {
    assert.deepEqual(notesSince([], "v35", "v36"), []);
    assert.deepEqual(notesSince(undefined, "v35", "v36"), []);
    assert.deepEqual(notesSince(log, undefined, "v36"), []);
  });

  it("counts from what this device was last shown", () => {
    assert.equal(startingPoint({ seen: "v36", running: "v38", hasDeck: true }), "v36");
  });

  it("tells a device that was in use before the record existed what this version brought", () => {
    // Her phone on its first prompting shell: v35 knew nothing of this.
    assert.equal(startingPoint({ seen: undefined, running: "v36", hasDeck: true }), "v35");
  });

  it("tells a device that has just installed the app nothing", () => {
    assert.equal(startingPoint({ seen: undefined, running: "v36", hasDeck: false }), "v36");
  });
});

describe("what the sheet says above More info (#114)", () => {
  const entry = (n) => ({ version: `v${n}`, summary: `summary ${n}`, notes: [] });

  it("gives one version's summary as a sentence, as before", () => {
    assert.deepEqual(sheetSummary([entry(45)]), { text: "summary 45", items: [], more: 0 });
  });

  it("lists every version's summary when more than one arrives, newest first", () => {
    // The case that prompted it: v42 → v45, where v45's one-line fix stood for
    // the tab bar changing shape in v43.
    const { text, items, more } = sheetSummary([entry(45), entry(44), entry(43)]);
    assert.equal(text, "3 Aktualisierungen auf einmal:");
    assert.deepEqual(items, ["summary 45", "summary 44", "summary 43"]);
    assert.equal(more, 0);
  });

  it("counts the rest past a handful, so the sheet does not scroll before Update", () => {
    const many = [50, 49, 48, 47, 46, 45].map(entry);
    const { text, items, more } = sheetSummary(many);
    assert.equal(text, "6 Aktualisierungen auf einmal:");
    assert.equal(items.length, SUMMARIES_SHOWN);
    assert.equal(more, 6 - SUMMARIES_SHOWN);
  });

  it("says nothing of its own when there are no notes to go on", () => {
    assert.deepEqual(sheetSummary([]), { text: undefined, items: [], more: 0 });
    assert.deepEqual(sheetSummary(undefined), { text: undefined, items: [], more: 0 });
  });
});

describe("changelog.json", () => {
  // The prompt's "More info" is only as good as this file, and the moment it
  // is forgotten is the moment VERSION is bumped. CI already refuses a client
  // change without a bump; this refuses a bump without a note.
  it("has an entry for the version sw.js is about to install", () => {
    assert.ok(
      changelog.some((entry) => entry.version === swVersion),
      `sw.js is ${swVersion} and changelog.json has no entry for it — add one (plain words, for her)`,
    );
  });

  it("gives every entry a version, a one-line summary and a list of notes", () => {
    for (const entry of changelog) {
      assert.ok(!Number.isNaN(versionNumber(entry.version)), `bad version: ${entry.version}`);
      assert.equal(typeof entry.summary, "string", `${entry.version}: summary`);
      assert.ok(entry.summary.length > 0 && !entry.summary.includes("\n"), `${entry.version}: one line`);
      assert.ok(Array.isArray(entry.notes), `${entry.version}: notes`);
      assert.ok(entry.notes.every((n) => typeof n === "string" && n.length > 0), `${entry.version}: notes`);
    }
  });

  it("names each version once, and none newer than the shell", () => {
    const versions = changelog.map((e) => e.version);
    assert.equal(new Set(versions).size, versions.length, "a version appears twice");
    assert.ok(
      versions.every((v) => versionNumber(v) <= versionNumber(swVersion)),
      "an entry is newer than sw.js — a note for a version that has not shipped",
    );
  });
});
