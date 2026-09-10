-- The plain kana reading, for search.
--
-- `word_furigana` holds Anki's notation — 食べる is stored as `食[た]べる` — so
-- a search for たべ can never match it: the kana are split around the bracket.
-- Browse (design 32) promises "search matches Japanese, reading and gloss", and
-- the reading half of that quietly did nothing.
--
-- Kaishi has the plain reading in a separate field, `Word Reading`, which the
-- import was simply not carrying. Nothing derived: this is a column the deck
-- already fills.
--
-- Existing rows are backfilled by re-running the import, which is safe — cards
-- are keyed on Anki's note ids, so rows are updated in place (import/README).
ALTER TABLE cards ADD COLUMN word_reading TEXT;

CREATE INDEX idx_cards_reading ON cards(word_reading);
