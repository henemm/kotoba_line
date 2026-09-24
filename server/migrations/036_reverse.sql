-- A card of hers asked the other way round (#284), as Noji does it.
--
-- In Noji she marks a card "Reverse", and it becomes two cards: "the main
-- card and its reverse may have different progress and they start learning
-- independently" (help.noji.io, Reversing your Cards). 61 of the 319 cards in
-- her "100 vokabeln" were two-way on 2026-09-24; the import stored the flag
-- and nothing read it (#137, #283).
--
-- So a reverse is a row of its own, pointing at the card it mirrors. Its own
-- id, its own `card_state`, its own `review_events` — which is what keeps
-- §4's rules: the log is still one card per answer, and the cache is still
-- one row per card, rebuilt the same way. `deleted_at` is how it is switched
-- off, so switching it on again brings back the same card and its history
-- (server/src/reverse.js).
ALTER TABLE cards ADD COLUMN reverse_of INTEGER REFERENCES cards(id);

CREATE UNIQUE INDEX idx_cards_reverse_of ON cards(reverse_of) WHERE reverse_of IS NOT NULL;

-- Its content is the original's, kept equal here rather than by every writer:
-- the card form, but also the import scripts that fill a column in place
-- (German meanings, generated word audio, …) and know nothing of reverses.
-- `updated_at` moves with it, so a phone fetches the reverse again too.
-- Topics are rows of their own and are copied by reverse.js (`mirror`).
CREATE TRIGGER cards_reverse_follows AFTER UPDATE ON cards
WHEN NEW.reverse_of IS NULL
BEGIN
  UPDATE cards SET
    word = NEW.word, word_furigana = NEW.word_furigana, word_reading = NEW.word_reading,
    word_pitch = NEW.word_pitch, word_meaning = NEW.word_meaning, word_audio = NEW.word_audio,
    sentence = NEW.sentence, sentence_furigana = NEW.sentence_furigana,
    sentence_meaning = NEW.sentence_meaning, sentence_audio = NEW.sentence_audio,
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
