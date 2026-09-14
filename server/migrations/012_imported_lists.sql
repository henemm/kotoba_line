-- Her own lists, imported from Noji (#137).
--
-- She learns from two decks she built in Noji, German on the front and romaji
-- on the back. Henning's rules for bringing them in: the lists stay lists,
-- nothing is mixed into Kaishi, and the cards the check list found doubtful
-- carry a marking nobody sees, so they can be corrected later.
--
-- A column rather than a `lists` table: no screen selects by list yet, and a
-- table with nothing to join it to is a schema to maintain for nothing. When
-- sessions can be filtered by list, `list_name` is what they filter on.

-- Which of her lists the card came from ("100 vokabeln", "1000"). NULL for
-- Kaishi and for words she adds in the app.
ALTER TABLE cards ADD COLUMN list_name TEXT;

-- Where it came from, for finding the card again: "noji:<list>:<note id>".
-- Unique per owner, which is what makes running the import twice harmless.
ALTER TABLE cards ADD COLUMN import_ref TEXT;
CREATE UNIQUE INDEX idx_cards_import_ref ON cards(owner_id, import_ref) WHERE import_ref IS NOT NULL;

-- The invisible marking: why the check list did not confirm this card. NULL
-- when Wadoku confirmed it. Never sent to a device (routes/deck.js lists its
-- columns), never drawn.
ALTER TABLE cards ADD COLUMN import_flag TEXT
  CHECK (import_flag IN ('meaning', 'spelling', 'reversed', 'inflected', 'sentence'));

-- Everything a later correction needs, as imported: her own front and back
-- (a card enriched from Kaishi shows Kaishi's spelling, not hers), the
-- position in her list, the Kaishi card it was enriched from, and what Wadoku
-- said. Server-side only, like the flag.
ALTER TABLE cards ADD COLUMN import_source TEXT
  CHECK (import_source IS NULL OR json_valid(import_source));
