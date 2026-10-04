-- Who may sign in. Edited only with scripts/server/allow.sh.
CREATE TABLE allowlist (
  email TEXT PRIMARY KEY
);

-- Per-user log generation. "Use local" / reset starts a new generation; older generations
-- stay in `events` as an archive and are never deleted.
CREATE TABLE users (
  email TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 1
);

-- The synced event log: opaque client events (see web/js/state.js), deduplicated by id.
-- `seq` is the server's arrival order, used as the clients' sync cursor.
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  gen INTEGER NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE (email, gen, id)
);
CREATE INDEX events_by_user ON events (email, gen, seq);
