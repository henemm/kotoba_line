-- Her own and native-speaker recordings (#183 follow-up) grew into a control
-- on most cards over v100-v104 (#185); Henning, 2026-09-16, asked for a
-- switch to turn all of it off. Defaults to on — it is what the feature was
-- built for, and the accounts that exist keep working exactly as they do
-- today until someone touches the switch.
ALTER TABLE user_settings ADD COLUMN recording_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (recording_enabled IN (0, 1));
