# Deck import

Turns the Kaishi 1.5k `.apkg` into rows in `cards` and audio files on disk (§8).

```sh
npm run import                            # download the latest release, import
npm run import -- --apkg ./Kaishi.apkg    # use a local file
npm run import -- --db /srv/kotoba/data/kotoba.sqlite --media /srv/kotoba/media
npm run verify-import                     # twenty random cards, audio included
```

Runs on a workstation, not in the container: it is the only part of the project
that reaches out for third-party data. Nothing it produces is committed — the
deck has its own licence and its audio is ~75 MB.

## Three things §8 gets wrong

Each cost an afternoon to rediscover, so they are written down rather than
left in the code.

**The media index is not JSON.** §8 calls it "numbered media files mapped by a
JSON index". Since Anki's v3 export format it is a zstd-compressed protobuf
message. `lib/protobuf.js` reads it in about eighty lines — the schema is three
fields and needs no library and no `.proto` file.

**Every media file is individually zstd-compressed.** §8 does not mention this.
Copy the numbered members straight out of the archive and you get 4,354 files
with the right names and unplayable contents. `verify.js` checks the first
bytes of sampled audio for exactly this reason.

**Decompression needs no tool and no dependency.** §8 treats the zstd step as
the awkward part and suggests it may push the whole job past the hour that
justifies falling back to a manual Anki Desktop export. Node has had zstd in
`node:zlib` since 22.15, so it is one call. **The automated route works; the
manual fallback is not needed.**

## What the current deck actually contains

Measured, not assumed, against the release of 2026-08-15:

| | |
|---|---|
| Notes in the archive | 1,501 |
| Imported as cards | 1,500 |
| Skipped | 1 — a "Welcome to Kaishi 1.5k!" note with no word meaning |
| Cards with word audio | 1,499 |
| Cards with a sentence | 1,500 |
| Media files in the index | 4,354 |
| Audio written | 2,972 (75.3 MB) |
| Media skipped | 1,382 — illustrations and unreferenced audio |
| **Notes carrying a tag** | **0** |

That last row is why §5a needs a separate tagging pass: the deck ships with no
topic tags at all, and the filters, the topic picker and the per-topic progress
on the Stats screen all depend on them.

## Decisions

**Card ids are Anki's note ids.** They are stable across re-imports, so
updating the deck leaves every `review_events` row pointing at the card it was
recorded against. Re-running the import updates rows in place — verified: two
runs, 1,500 cards, identical ids.

**Only referenced audio is written.** The archive also carries an illustration
per card for the deck's Picture field. Our schema has no column for it and no
screen shows one, so copying them would be ~30 MB nothing ever asks for.

**Sentences keep their `<b>`.** Kaishi already marks the target word inside the
example sentence. The prototype guesses at the same thing by stripping a
trailing kana and substring-matching, which will misfire on conjugated forms —
the deck knows the answer, so the markup is preserved and the client can stop
guessing.

**"Word Furigana" wins over "Word Reading".** The deck carries both — `わたし`
and `私[わたし]` — where the spec has one column. The furigana form is kept
because it can be rendered either way.

**The notetype is found by its fields, not its name.** A renamed or forked deck
still imports; a deck that carries none of `Word`, `Word Meaning`, `Word Audio`,
`Sentence` fails loudly instead of writing nonsense.

## Layout

```
lib/zip.js        minimal zip reader — STORED and DEFLATE, CRC checked
lib/protobuf.js   just enough protobuf for Anki's media index
lib/apkg.js       the two together, plus zstd
lib/fields.js     note fields → a cards row
import-deck.js    the CLI
verify.js         samples imported cards and their audio
test/             runs against a synthetic .apkg, so CI never downloads 110 MB
```

No dependencies beyond `better-sqlite3`, which the server already has.
