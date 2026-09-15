-- How many cards one deck asks for a day, new and review together (#123
-- reversed, Henning, 2026-09-15).
--
-- The deck page asked "How long" before every session, next to "14 cards for
-- today" — two numbers that disagreed, and Charlotte found it confusing. Noji,
-- where she learned, asks nothing: a session is the day's cards, and a deck
-- has "New cards per day" and "Max cards per day". This is the second.
--
-- NULL is no limit, the default for every deck: the session is then today's
-- cards, capped at 60 a sitting (MAX_SESSION_LENGTH), and she can stop at any
-- time. `user_settings.session_length` stays, because an older shell reads it.
ALTER TABLE deck_settings ADD COLUMN max_per_day INTEGER
  CHECK (max_per_day IS NULL OR max_per_day BETWEEN 10 AND 500);
