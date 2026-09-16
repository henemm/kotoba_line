-- More new cards for today, on her own say-so (#179, v90).
--
-- The daily allowance paces an ordinary day; it is not meant to end one. When
-- she asks for more, the deck's allowance is raised for that day only:
-- `extra_new` cards on top of `new_per_day`, for the day named in
-- `extra_new_day` (her device's calendar day, §8a). Tomorrow the row is
-- ignored and the deck is back to its own pace.
ALTER TABLE deck_settings ADD COLUMN extra_new INTEGER NOT NULL DEFAULT 0
  CHECK (extra_new >= 0);
ALTER TABLE deck_settings ADD COLUMN extra_new_day TEXT;
