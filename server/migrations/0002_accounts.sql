-- Open signup with quotas: per-account storage accounting, blocking and quota overrides.
ALTER TABLE users ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;   -- stored event bytes, all generations
ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0; -- 1: sync refused
ALTER TABLE users ADD COLUMN quota INTEGER;                      -- bytes; NULL = MAX_USER_BYTES
ALTER TABLE users ADD COLUMN created INTEGER;                    -- ms timestamp of signup
UPDATE users SET bytes = (
  SELECT COALESCE(SUM(LENGTH(CAST(body AS BLOB))), 0) FROM events WHERE events.email = users.email
);
