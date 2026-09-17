-- #183, 2026-09-17 (Henning: "Ich möchte überall Computer-Audio haben"):
-- a generated recording for a word that has no human one, written by
-- import/generate-word-sounds.js. Kept apart from word_audio on purpose:
-- word_audio is a person's voice or the deck's, and everything that links
-- her card to a Kaishi word (cards.js's spoken(), kaishi-match.js) reads it
-- as that.
--
-- word_audio_generated_for is the exact word the file says. The deck query
-- hands the file out only while it still equals `word`, so an edit silences
-- it at once — without every path that writes `word` having to remember to
-- clear two more columns — until the generator makes a new one.
--
-- word_audio_checked: 1 when two independent sources agree on the accent
-- spoken (VOICEVOX's own and Kanjium's, or the deck's pitch), 0 when not —
-- the card then shows its asterisk.
ALTER TABLE cards ADD COLUMN word_audio_generated TEXT;
ALTER TABLE cards ADD COLUMN word_audio_generated_for TEXT;
ALTER TABLE cards ADD COLUMN word_audio_checked INTEGER;
