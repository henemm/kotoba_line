-- Example words on a kana card (#158, v78): up to two words that start with
-- the kana, as JSON — [{ "kana": "カメラ", "meaning": "camera", "source":
-- "jlpt-n5" }]. Written by `npm run import-kana` (import/lib/examples.js);
-- NULL on every other card, and on a kana no listed word starts with.
ALTER TABLE cards ADD COLUMN word_examples TEXT
  CHECK (word_examples IS NULL OR (json_valid(word_examples) AND json_type(word_examples) = 'array'));
