-- „Höchstens gleichzeitig lernen", per deck (#314).
--
-- Charlotte, 2026-10-04: „vielleicht den ersten Durchlauf mit höchstens
-- fünfzig Vokabeln und dann nachher, wenn ich die gemeistert habe, … dass
-- dann erst die Vokabeln dazukommen." New cards are let in only while fewer
-- than this many of the deck's cards are still open — answered, but not yet
-- a week apart (queue.js, OPEN_DAYS). NULL is no such limit, which is what
-- every deck did before this column.
ALTER TABLE deck_settings ADD COLUMN max_open INTEGER
  CHECK (max_open IS NULL OR max_open BETWEEN 10 AND 500);
