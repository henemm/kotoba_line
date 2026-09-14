-- No English on the cards from her Noji lists (#137).
--
-- A card from her lists that Kaishi could fill in took Kaishi's example
-- sentence, and with it Kaishi's English translation: "Benutzen" on the front,
-- "tsukau" on the back, "I use the computer every day." under it. She learns
-- German to Japanese; a third language on the same card is one more thing to
-- be confused by, and Henning asked for the translation to go (2026-09-14).
--
-- Removed from the card rather than hidden on screen, so that a German
-- translation written into the field later shows like any other. The
-- recording and the Japanese sentence stay.
--
-- Only where the translation is still exactly the Kaishi card's, so a
-- translation she has written herself since the import is left alone. Stamped
-- for sync, so a device that already has the card drops the English too.
UPDATE cards
   SET sentence_meaning = NULL,
       updated_at = unixepoch()
 WHERE import_ref IS NOT NULL
   AND sentence_meaning IS NOT NULL
   AND sentence_meaning = (
     SELECT k.sentence_meaning FROM cards k
      WHERE k.id = json_extract(cards.import_source, '$.kaishiId')
        AND k.deck = 'kaishi'
   );
