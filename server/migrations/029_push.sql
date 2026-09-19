-- "Deine nächsten Karten sind bereit" (#248), as Noji does it.
--
-- A device that allowed notifications leaves its Web Push subscription here:
-- the endpoint its browser's push service gave it and the two keys a message
-- is encrypted to. `time_zone` is the device's, for the quiet hours. A device
-- that uninstalls the app or withdraws permission answers 404 or 410 on the
-- next send, and its row is deleted then.
CREATE TABLE push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  time_zone   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_ok_at  INTEGER
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

-- One row per notification sent: what `due_until` it covered, so a card is
-- announced once, and a trace to check "did she get any?" against.
CREATE TABLE push_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL,
  cards      INTEGER NOT NULL,
  due_until  INTEGER NOT NULL,
  sent_at    INTEGER NOT NULL,
  delivered  INTEGER NOT NULL
);
CREATE INDEX push_log_user_sent ON push_log (user_id, sent_at);

-- The server's VAPID key pair, made on first use. In the database, never in
-- the repository: it is a secret, and a key that changes would silently
-- orphan every subscription made with the old one.
CREATE TABLE server_keys (
  name   TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
