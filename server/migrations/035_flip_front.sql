-- What „Karte umdrehen" shows on the front, per deck (#275, #271).
--
-- Charlotte, 2026-09-24: „bei den Kaishi Vokabeln ist das extra, dass das
-- als erstes auf Japanisch steht und dann erst auf Deutsch, oder kann ich
-- das einstellen?" Henning asked for a setting rather than a switch.
--
-- 'word' is the Japanese on the front, 'meaning' the German. NULL is the
-- deck's default, which is what every deck did before this column: the
-- meaning for her own decks (her Noji lists were learned that way round,
-- #137), the word for everything else (deck-settings.js, `defaultFlipFront`).
ALTER TABLE deck_settings ADD COLUMN flip_front TEXT
  CHECK (flip_front IS NULL OR flip_front IN ('word', 'meaning'));
