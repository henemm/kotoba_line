-- #185, 2026-09-17: a card's pronunciation has two sources only — generated
-- (VOICEVOX) or a native speaker. Her own voice was never meant to be one:
-- she says a word to compare it with the real thing, and that attempt now
-- lives only in the open screen's memory (client/src/ui/answer-recorder.js).
-- The 'own' kind this table stored until v116 is retired with it.
--
-- Soft delete, not DELETE: measured before this ran, production held six
-- 'own' rows, three of them hers and still live. Setting deleted_at makes
-- them unreachable (recordings.js no longer reads that kind at all) without
-- destroying anything — the rows and their files under media/practice/ stay
-- where they are, should she ever want one back.
UPDATE card_recordings
   SET deleted_at = CAST(strftime('%s', 'now') AS INTEGER)
 WHERE kind = 'own' AND deleted_at IS NULL;
