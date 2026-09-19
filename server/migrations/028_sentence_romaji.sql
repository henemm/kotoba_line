-- A sentence in romaji, keyed by the sentence itself (2026-09-19).
--
-- Written by import/sentence-romaji.js from the deck's own furigana, with a
-- dictionary tokenizer only deciding where words end (import/lib/
-- sentence-romaji.js says why each part comes from where). Keyed by the
-- sentence's text, not a card: her own cards that took a Kaishi sentence
-- (v70) find its romaji without a copy, and a sentence that changes simply
-- stops matching — never a stale romaji under a new sentence.
--
-- Derived data: nothing is folded from it, it can be dropped and rebuilt by
-- running the import again.
CREATE TABLE sentence_romaji (
  sentence TEXT PRIMARY KEY,
  romaji   TEXT NOT NULL
);
