import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

export function openDatabase(config) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.uploadsDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(config.databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS service_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pairings (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      public_token_hash TEXT NOT NULL UNIQUE,
      management_token_hash TEXT NOT NULL UNIQUE,
      upload_token_hash TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      recovery_until INTEGER NOT NULL,
      revoked_at INTEGER,
      byte_size INTEGER NOT NULL,
      has_archive INTEGER NOT NULL CHECK (has_archive IN (0, 1))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS assets (
      share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      PRIMARY KEY (share_id, filename)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS staging_uploads (
      id TEXT PRIMARY KEY,
      upload_token_hash TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      reserved_bytes INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS shares_expiry_idx ON shares(expires_at);
    CREATE INDEX IF NOT EXISTS shares_revoked_idx ON shares(revoked_at);
    CREATE INDEX IF NOT EXISTS pairings_expiry_idx ON pairings(expires_at);
  `);
  const fingerprint = createHash('sha256')
    .update(Buffer.from(config.receiptSecret, 'base64url'))
    .digest('hex');
  const stored = db.prepare("SELECT value FROM service_metadata WHERE key = 'receipt-secret-sha256'").get();
  if (
    (stored && stored.value !== fingerprint) ||
    (!stored && db.prepare('SELECT COUNT(*) AS count FROM shares').get().count > 0)
  ) {
    db.close();
    throw new Error(
      'Receipt secret does not match this database. Restore the matching server secret before starting.',
    );
  }
  if (!stored)
    db.prepare("INSERT INTO service_metadata (key, value) VALUES ('receipt-secret-sha256', ?)").run(
      fingerprint,
    );
  return db;
}
