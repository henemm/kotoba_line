import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * import/german.tsv (#134) — what can be checked without the deck.
 *
 * `import/check-german.js` does the rest against the real database (does the
 * card id exist, do two cards share a meaning across the whole deck). CI has
 * no deck, so this holds the part that lives in the file itself — including
 * the check that actually found something: a meaning that repeats one of its
 * own words. 先輩 read "Ältere, Ältere (in Schule oder Beruf)" and shipped
 * past the collision check, which only ever compares whole strings.
 */
const rows = readFileSync(new URL("../german.tsv", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l, i) => {
    const parts = l.split("\t");
    return { line: i + 1, id: parts[0], word: parts[1], de: parts[2], satz: parts[3], note: parts[4], parts };
  });

describe("import/german.tsv (#134)", () => {
  it("covers the deck once per card", () => {
    assert.equal(rows.length, 1526, `${rows.length} Zeilen`);
    const ids = new Set(rows.map((r) => r.id));
    assert.equal(ids.size, rows.length, "eine Karten-ID kommt doppelt vor");
  });

  it("has five columns on every line, and a meaning on every card", () => {
    for (const r of rows) {
      assert.equal(r.parts.length, 5, `Zeile ${r.line} (${r.word}) hat ${r.parts.length} Spalten`);
      assert.ok(r.de?.trim(), `Zeile ${r.line} (${r.word}) hat keine Bedeutung`);
      assert.ok(/^\d+$/.test(r.id), `Zeile ${r.line}: „${r.id}“ ist keine Karten-ID`);
    }
  });

  it("gives no two cards the same German meaning", () => {
    const seen = new Map();
    const clash = [];
    for (const r of rows) {
      const key = r.de.trim().toLowerCase();
      if (seen.has(key)) clash.push(`„${r.de}“ — ${seen.get(key)} und ${r.word}`);
      seen.set(key, r.word);
    }
    // Zwei Karten mit demselben Text stellen bei „Bedeutung wählen“ die
    // richtige Antwort doppelt in die Reihe (client/src/deck.js,
    // pickDistractors) — und sie bekäme „falsch“ für eine richtige Wahl.
    assert.deepEqual(clash.slice(0, 10), [], `${clash.length} Kollisionen`);
  });

  it("never repeats a content word inside one meaning", () => {
    const bad = [];
    for (const r of rows) {
      // Funktionswörter wiederholen sich zu Recht: „noch, noch nicht“,
      // „schlafen, schlafen gehen“. Geprüft werden nur Inhaltswörter, und
      // was in Klammern steht, ist ja gerade das Unterscheidende.
      const stop = new Set([
        "nicht", "noch", "sein", "sich", "haben", "werden", "etwas", "mehr", "jetzt",
        "hier", "schon", "lassen", "bitte", "gehen", "kommen", "reihe", "leben",
        "schlafen", "stehen", "gefallen", "können", "heute", "ernst", "selbst",
      ]);
      const toks = (r.de.split("(")[0].match(/[A-Za-zÄÖÜäöüß]{4,}/g) ?? []).map((t) => t.toLowerCase());
      const dup = toks.filter((t, i) => !stop.has(t) && toks.indexOf(t) !== i);
      if (dup.length) bad.push(`${r.word}: „${r.de}“ (${[...new Set(dup)].join(", ")})`);
    }
    assert.deepEqual(bad, [], `${bad.length} Bedeutungen wiederholen ein eigenes Wort`);
  });

  it("keeps the conventions the file's own header sets out", () => {
    // 1. „to <Verb>“ wurde der blanke Infinitiv, nicht „zu machen“. Gemeint
    // ist der nackte Infinitiv als Bedeutung — „zu sehen sein“ und „zu hören
    // sein“ sind deutsche Fügungen und kein Verstoß (見える, 聞こえる).
    const zu = rows.filter((r) => /(^|, )zu [a-zäöü]+en(,|$)/.test(r.de));
    assert.deepEqual(zu.map((r) => `${r.word}: ${r.de}`), [], "Infinitiv mit „zu“");
    // 3. Klammern blieben Klammern — und wurden übersetzt, nicht übernommen.
    const english = rows.filter((r) => /\((polite|formal|male|female|animate|inanimate)\)/i.test(r.de));
    assert.deepEqual(english.map((r) => `${r.word}: ${r.de}`), [], "englische Klammer stehen geblieben");
    // Kein Rest des Englischen: eine Bedeutung, die noch genau so heißt wie
    // die englische, ist entweder ein Versehen oder ein echtes Lehnwort.
    const same = rows.filter((r) => /^(to |the |a )/i.test(r.de));
    assert.deepEqual(same.map((r) => `${r.word}: ${r.de}`), [], "englische Bedeutung stehen geblieben");
  });

  it("carries the 24 words the deck holds twice, told apart", () => {
    const byWord = new Map();
    for (const r of rows) byWord.set(r.word, [...(byWord.get(r.word) ?? []), r]);
    const twice = [...byWord.entries()].filter(([, v]) => v.length > 1);
    assert.equal(twice.length, 24, `${twice.length} Wörter auf mehreren Karten`);
    const same = twice.filter(([, v]) => new Set(v.map((r) => r.de.toLowerCase())).size === 1);
    // #134: die Datei ist auf die Karten-ID geschlüsselt, damit もう „schon“
    // und もう „noch“ zwei Karten bleiben. Gäben beide dasselbe, wäre genau
    // das verloren, wofür die Schlüsselung da ist.
    assert.deepEqual(same.map(([w]) => w), [], "doppeltes Wort, gleiche Bedeutung");
  });
});
