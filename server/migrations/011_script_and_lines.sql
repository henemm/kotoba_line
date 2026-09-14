-- Two settings Henning asked for on 2026-09-14, once it was clear she learns
-- in romaji (German front, romaji back, in Noji) and not in Japanese script.
--
-- japanese_script (#135): on by default, so nobody's app changes until they
-- touch it. Off shows words in romaji and drops the characters used as
-- decoration.
ALTER TABLE user_settings ADD COLUMN japanese_script INTEGER NOT NULL DEFAULT 1
  CHECK (japanese_script IN (0, 1));

-- hidden_modes (#133): the practice lines she has switched off, as a JSON
-- array of mode keys. Fewer than five, so at least one line always remains —
-- the route says so too, but this is the one that cannot be bypassed.
ALTER TABLE user_settings ADD COLUMN hidden_modes TEXT NOT NULL DEFAULT '[]'
  CHECK (
    json_valid(hidden_modes)
    AND json_type(hidden_modes) = 'array'
    AND json_array_length(hidden_modes) < 5
  );
