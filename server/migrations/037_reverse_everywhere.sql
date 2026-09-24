-- The other way round in every deck, not only her own (#284, Henning
-- 2026-09-24): „je Deck sagen, ob man auch in die Gegenrichtung lernen will",
-- and per card as in Noji, whose Reverse is a switch on a card and "Select
-- all → Reverse" for a deck.
--
-- A reverse of a Kaishi word belongs to the account that switched it on: it
-- is a card of hers (`deck = 'personal'`, `owner_id`), pointing at the shared
-- Kaishi card. So one Kaishi card can have a reverse per account, and the
-- rule "one reverse per card" becomes one per card and owner.
DROP INDEX idx_cards_reverse_of;
CREATE UNIQUE INDEX idx_cards_reverse_of ON cards(reverse_of, owner_id) WHERE reverse_of IS NOT NULL;

-- A deck's „Auch andersherum abfragen": 1 on, 0 off, NULL never set (off).
-- What it last switched every card of the deck to, and what a card added to
-- the deck starts with; single cards can differ from it (reverse.js).
ALTER TABLE deck_settings ADD COLUMN reverse INTEGER CHECK (reverse IS NULL OR reverse IN (0, 1));

-- Kaishi's frequency order is how its new cards come in, and a reverse takes
-- its original's place in it (queue.js), so the rank follows the original too.
DROP TRIGGER cards_reverse_follows;
CREATE TRIGGER cards_reverse_follows AFTER UPDATE ON cards
WHEN NEW.reverse_of IS NULL
BEGIN
  UPDATE cards SET
    word = NEW.word, word_furigana = NEW.word_furigana, word_reading = NEW.word_reading,
    word_pitch = NEW.word_pitch, word_meaning = NEW.word_meaning, word_audio = NEW.word_audio,
    sentence = NEW.sentence, sentence_furigana = NEW.sentence_furigana,
    sentence_meaning = NEW.sentence_meaning, sentence_audio = NEW.sentence_audio,
    frequency_rank = NEW.frequency_rank,
    deck_id = NEW.deck_id, list_name = NEW.list_name,
    word_examples = NEW.word_examples, word_mnemonic = NEW.word_mnemonic,
    word_audio_generated = NEW.word_audio_generated,
    word_audio_generated_for = NEW.word_audio_generated_for,
    word_audio_checked = NEW.word_audio_checked,
    topics_offered_at = NEW.topics_offered_at,
    word_meaning_en = NEW.word_meaning_en, sentence_meaning_en = NEW.sentence_meaning_en,
    updated_at = max(updated_at, NEW.updated_at)
  WHERE reverse_of = NEW.id AND deleted_at IS NULL;
END;
