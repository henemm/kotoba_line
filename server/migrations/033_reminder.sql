-- „Du hast heute noch nicht geübt" (#99), Henning 2026-09-21.
--
-- Parked since 2026-09-13 because Charlotte said „Nicht wirklich, aber
-- vielleicht" to reminders. Unparked by a measurement: she answered no card
-- on 19, 20 and 21 September, was in the app once on the 19th without
-- practising, and nothing reminded her. 23 cards were due.
--
-- Off for everyone. Noji reminds twice a day; this is once, at 18:00 on her
-- own clock, and only on a day with no answer. A switch that is on by default
-- would reach fifteen travellers who never asked for it.
ALTER TABLE user_settings ADD COLUMN reminder INTEGER NOT NULL DEFAULT 0
  CHECK (reminder IN (0, 1));
