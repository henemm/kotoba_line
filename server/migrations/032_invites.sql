-- Sign-up by invitation code (#260, Henning 2026-09-20): Julia travels with
-- her department, "das sind vielleicht 15 Doktoranten. Ich kenne deren Namen
-- nicht" — so one code for the group rather than an account per name, and no
-- open registration: the app is on a public address, and without a code
-- anyone who finds it could help themselves to the deck.
--
-- A code carries what the accounts it makes should start with (`settings`,
-- the same shape PATCH /api/settings takes), so the travellers begin the way
-- Julia does: Einstieg on, Japanese script off. It also carries its own end:
-- `max_uses` and `expires_at`, so the door closes without anyone remembering
-- to close it.
CREATE TABLE invites (
  code       TEXT    PRIMARY KEY CHECK (code = upper(code) AND length(code) BETWEEN 4 AND 32),
  label      TEXT    NOT NULL,
  settings   TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  max_uses   INTEGER NOT NULL CHECK (max_uses > 0),
  used       INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Which account came from which code: for counting, and so a code that turns
-- out to be in the wrong hands can be traced to what it let in.
ALTER TABLE users ADD COLUMN invite_code TEXT REFERENCES invites(code);
