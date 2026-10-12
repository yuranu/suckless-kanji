-- Accounts deleted by their owner (Settings -> Delete profile). Only a SHA-256 of the email
-- and the time: sessions issued before it are refused, so a forgotten signed-in device
-- cannot recreate the account and upload its copy. Signing in again starts a fresh account.
CREATE TABLE deleted_accounts (
  email_hash TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
