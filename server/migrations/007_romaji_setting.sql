-- Show romaji alongside the kana reading (#73), same pattern as pitch_accent:
-- off by default, one boolean the settings screen flips.
ALTER TABLE user_settings ADD COLUMN romaji INTEGER NOT NULL DEFAULT 0;
