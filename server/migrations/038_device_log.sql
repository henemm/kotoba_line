-- The flight recorder (#299): what a device did while it could not reach
-- the server — starts, requests and how they ended, screens that sat on
-- "…", errors — sent up the next time a request gets through
-- (client/src/trace.js). Technical lines only; nothing she typed.
--
-- A line is (device, seq): the device numbers its own lines, so a batch
-- posted twice lands once. `at` is the device's clock in milliseconds —
-- this is for reading a timeline, not for anything scheduled. `received_at`
-- is the server's, also in milliseconds.
CREATE TABLE device_log (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  device      TEXT    NOT NULL,
  seq         INTEGER NOT NULL,
  at          INTEGER NOT NULL,
  kind        TEXT    NOT NULL,
  data        TEXT,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device, seq)
);
CREATE INDEX idx_device_log_user_at ON device_log(user_id, at);
