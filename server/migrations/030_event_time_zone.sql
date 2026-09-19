-- The device's time zone with every answer (#250), an IANA name like
-- "Asia/Tokyo" from the X-Time-Zone header of the request that brought it.
--
-- The scheduler counts the days between two answers on her wall calendar,
-- not on UTC's, and a replay (§3) has to land on the same state wherever she
-- is when it runs — so the zone is stored with the answer, not looked up.
-- NULL for everything from before this column: those count as Asia/Tokyo,
-- where every one of them was given (scheduler.js, `wall`).
ALTER TABLE review_events ADD COLUMN time_zone TEXT;
