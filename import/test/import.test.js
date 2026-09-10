import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openApkg } from "../lib/apkg.js";
import { FIELD_SEPARATOR, keepEmphasis, noteToCard, plainText, soundFilename } from "../lib/fields.js";
import { parseMediaEntries } from "../lib/protobuf.js";
import { readCentralDirectory, readEntry } from "../lib/zip.js";
import { DEFLATE, buildApkg, buildMediaIndex, buildZip, fakeMp3 } from "./build-apkg.js";

const tempFile = (bytes, name = "test.apkg") => {
  const dir = mkdtempSync(join(tmpdir(), "kotoba-apkg-"));
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

describe("zip reader", () => {
  it("reads stored and deflated members", () => {
    const zip = buildZip([
      { name: "plain", data: Buffer.from("hello") },
      { name: "squashed", data: Buffer.from("x".repeat(5000)), method: DEFLATE },
    ]);
    const entries = readCentralDirectory(zip);
    assert.deepEqual([...entries.keys()], ["plain", "squashed"]);
    assert.equal(readEntry(zip, entries.get("plain")).toString(), "hello");
    assert.equal(readEntry(zip, entries.get("squashed")).length, 5000);
  });

  it("finds the directory even with trailing bytes it does not understand", () => {
    const zip = buildZip([{ name: "a", data: Buffer.from("A") }]);
    const entries = readCentralDirectory(zip);
    assert.equal(readEntry(zip, entries.get("a")).toString(), "A");
  });

  it("refuses something that is not a zip", () => {
    assert.throws(
      () => readCentralDirectory(Buffer.alloc(200)),
      /no end-of-central-directory/,
    );
  });

  it("catches a truncated member by its checksum", () => {
    const zip = buildZip([{ name: "a", data: Buffer.from("original content") }]);
    const entries = readCentralDirectory(zip);
    // Corrupt one byte of the stored data.
    const corrupted = Buffer.from(zip);
    corrupted[entries.get("a").localOffset + 30 + 1] ^= 0xff;
    assert.throws(() => readEntry(corrupted, entries.get("a")), /failed its checksum/);
  });
});

describe("protobuf media index", () => {
  it("round-trips names and sizes", () => {
    const input = [
      { name: "JLPT_Tango_N5_0001.mp3", size: 40076 },
      { name: "私_ワタシ━_0_NHK-2016.mp3", size: 6957 },
      { name: "big.mp3", size: 3_000_000 }, // past 2^21, exercises the varint
    ];
    assert.deepEqual(parseMediaEntries(buildMediaIndex(input)), input);
  });

  it("handles an empty index", () => {
    assert.deepEqual(parseMediaEntries(Buffer.alloc(0)), []);
  });
});

describe("field mapping", () => {
  it("pulls the filename out of Anki's sound markup", () => {
    assert.equal(soundFilename("[sound:私_ワタシ━_0_NHK-2016.mp3]"), "私_ワタシ━_0_NHK-2016.mp3");
    assert.equal(soundFilename(""), undefined);
    assert.equal(soundFilename("no markup here"), undefined);
  });

  it("strips HTML but keeps the emphasis that marks the target word", () => {
    assert.equal(plainText("I (polite,<br>general)"), "I (polite, general)");
    assert.equal(plainText('<img alt="x" src="y.webp">'), "");
    assert.equal(plainText("a &amp; b"), "a & b");
    assert.equal(keepEmphasis("<b>私</b>はアンです。"), "<b>私</b>はアンです。");
    assert.equal(keepEmphasis('<div class="x"><b>私</b></div>'), "<b>私</b>");
  });

  const fields = new Map(
    [
      "Word", "Word Reading", "Word Meaning", "Word Furigana", "Word Audio",
      "Sentence", "Sentence Meaning", "Sentence Furigana", "Sentence Audio",
      "Notes", "Pitch Accent", "Pitch Accent Notes", "Frequency", "Picture",
    ].map((n, i) => [n, i]),
  );

  const flds = (o) =>
    [...fields.keys()].map((n) => o[n] ?? "").join("\x1f");

  it("maps a real note onto a card row", () => {
    const card = noteToCard(
      1234,
      flds({
        Word: "私",
        "Word Reading": "わたし",
        "Word Meaning": "I (polite, general)",
        "Word Furigana": "私[わたし]",
        "Word Audio": "[sound:私_ワタシ━_0_NHK-2016.mp3]",
        Sentence: "<b>私</b>はアンです。",
        "Sentence Meaning": "I am Ann.",
        "Sentence Audio": "[sound:JLPT_Tango_N5_0001.mp3]",
        Frequency: "19",
        // The accent as the deck draws it: ワ low, タシ overlined to the end.
        "Pitch Accent":
          'ワ<span style="position:relative;"><span style="display:inline;">タシ</span>' +
          '<span style="border-top-width:0.1em;border-top-style:solid;"></span></span>',
        Picture: '<img alt="x" src="y.webp">',
      }),
      fields,
    );

    assert.deepEqual(card, {
      id: 1234,
      word: "私",
      word_furigana: "私[わたし]",
      // The plain kana, kept apart from the furigana above: a search for わた
      // cannot match `私[わたし]`, where the brackets split it (migration 003).
      word_reading: "わたし",
      // The overline runs to the end and never falls: heiban, 私 [0] (#21).
      word_pitch: "0",
      word_meaning: "I (polite, general)",
      word_audio: "私_ワタシ━_0_NHK-2016.mp3",
      sentence: "<b>私</b>はアンです。",
      sentence_furigana: null,
      sentence_meaning: "I am Ann.",
      sentence_audio: "JLPT_Tango_N5_0001.mp3",
      frequency_rank: 19,
      deck: "kaishi",
    });
  });

  it("skips the deck's welcome note", () => {
    const welcome = noteToCard(
      1,
      flds({
        Word: "Welcome to Kaishi 1.5k! (version 2.4.2)<br>",
        Sentence: "<br>Kaishi (開始) is a modular Japanese vocabulary deck",
        "Sentence Meaning": "Good luck on your Japanese learning journey!",
        Frequency: "0",
      }),
      fields,
    );
    assert.equal(welcome, undefined, "a note with no meaning is not a card");
  });

  it("leaves a card without audio alone rather than inventing a filename", () => {
    const card = noteToCard(
      7,
      flds({ Word: "ねこ", "Word Meaning": "cat", Frequency: "900" }),
      fields,
      "personal",
    );
    assert.equal(card.word_audio, null);
    assert.equal(card.sentence_audio, null);
    assert.equal(card.deck, "personal");
  });
});

describe("opening an .apkg", () => {
  const pkg = () =>
    buildApkg({
      notes: [
        {
          id: 1,
          Word: "Welcome to Kaishi 1.5k!",
          "Sentence Meaning": "Good luck!",
          Frequency: "0",
        },
        {
          id: 100,
          Word: "私",
          "Word Meaning": "I (polite, general)",
          "Word Furigana": "私[わたし]",
          "Word Audio": "[sound:watashi.mp3]",
          Sentence: "<b>私</b>はアンです。",
          "Sentence Meaning": "I am Ann.",
          "Sentence Audio": "[sound:sentence.mp3]",
          Frequency: "19",
        },
      ],
      media: [
        { name: "watashi.mp3", data: fakeMp3("w") },
        { name: "sentence.mp3", data: fakeMp3("s") },
      ],
    });

  it("decompresses the collection and reads the media index", () => {
    const { path, cleanup } = tempFile(pkg());
    const opened = openApkg(path);

    assert.equal(opened.collectionName, "collection.anki21b");
    assert.equal(
      opened.collection.subarray(0, 15).toString("latin1"),
      "SQLite format 3",
    );
    assert.deepEqual(
      opened.mediaEntries.map((e) => e.name),
      ["watashi.mp3", "sentence.mp3"],
    );
    cleanup();
  });

  it("decompresses media rather than handing back the zstd frame", () => {
    const { path, cleanup } = tempFile(pkg());
    const opened = openApkg(path);

    const audio = opened.readMediaByName("watashi.mp3");
    assert.equal(audio.subarray(0, 3).toString("latin1"), "ID3");
    assert.notEqual(audio[0], 0x28, "0x28b52ffd would mean an undecompressed zstd frame");
    cleanup();
  });

  it("is undefined for a name the archive does not carry", () => {
    const { path, cleanup } = tempFile(pkg());
    assert.equal(openApkg(path).readMediaByName("nope.mp3"), undefined);
    cleanup();
  });

  it("refuses an archive with no collection", () => {
    const { path, cleanup } = tempFile(buildZip([{ name: "meta", data: Buffer.from("x") }]));
    assert.throws(() => openApkg(path), /no collection found/);
    cleanup();
  });
});

describe("the reading a search can actually match", () => {
  it("is the plain kana, not the bracket notation", () => {
    // 食べる is stored as 食[た]べる, where たべ is split around the bracket —
    // so browse's promise to "match Japanese, reading and gloss" needs the
    // separate field the deck already carries.
    const fields = new Map([
      ["Word", 0], ["Word Reading", 1], ["Word Meaning", 2], ["Word Furigana", 3],
    ]);
    const card = noteToCard(1, ["食べる", "たべる", "to eat", "食[た]べる"].join(FIELD_SEPARATOR), fields);
    assert.equal(card.word_reading, "たべる");
    assert.equal(card.word_furigana, "食[た]べる");
    assert.ok(card.word_reading.includes("たべ"));
    assert.ok(!card.word_furigana.includes("たべ"));
  });

  it("is null on a deck that has no such field, rather than a guess", () => {
    const fields = new Map([["Word", 0], ["Word Meaning", 1]]);
    const card = noteToCard(2, ["犬", "dog"].join(FIELD_SEPARATOR), fields);
    assert.equal(card.word_reading, null);
  });
});
