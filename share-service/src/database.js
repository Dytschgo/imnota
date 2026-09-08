import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

export function openDatabase(config) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.uploadsDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
  try {
    db.exec(`
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
      sender_name TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      recovery_until INTEGER NOT NULL,
      revoked_at INTEGER,
      byte_size INTEGER NOT NULL,
      metadata_byte_size INTEGER NOT NULL DEFAULT 0 CHECK (metadata_byte_size >= 0),
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
    CREATE TABLE IF NOT EXISTS share_bundles (
      share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
      bundle_number INTEGER NOT NULL CHECK (bundle_number BETWEEN 1 AND 999),
      markdown TEXT NOT NULL,
      image_filename TEXT,
      PRIMARY KEY (share_id, bundle_number)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS staging_uploads (
      id TEXT PRIMARY KEY,
      upload_token_hash TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      reserved_bytes INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS owner_sessions (
      token_hash TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      auth_fingerprint TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS owner_login_throttle (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      window_started_at INTEGER NOT NULL,
      failures INTEGER NOT NULL CHECK (failures >= 0),
      blocked_until INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS share_usage (
      share_id TEXT PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,
      page_views INTEGER NOT NULL DEFAULT 0 CHECK (page_views >= 0),
      markdown_requests INTEGER NOT NULL DEFAULT 0 CHECK (markdown_requests >= 0),
      asset_requests INTEGER NOT NULL DEFAULT 0 CHECK (asset_requests >= 0),
      archive_requests INTEGER NOT NULL DEFAULT 0 CHECK (archive_requests >= 0),
      last_accessed_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS shares_expiry_idx ON shares(expires_at);
    CREATE INDEX IF NOT EXISTS shares_revoked_idx ON shares(revoked_at);
    CREATE INDEX IF NOT EXISTS pairings_expiry_idx ON pairings(expires_at);
    CREATE INDEX IF NOT EXISTS owner_sessions_expiry_idx ON owner_sessions(expires_at);
    `);
    const shareColumns = db.prepare('PRAGMA table_info(shares)').all();
    if (!shareColumns.some((column) => column.name === 'sender_name'))
      db.exec('ALTER TABLE shares ADD COLUMN sender_name TEXT');
    if (!shareColumns.some((column) => column.name === 'metadata_byte_size'))
      db.exec(
        'ALTER TABLE shares ADD COLUMN metadata_byte_size INTEGER NOT NULL DEFAULT 0 CHECK (metadata_byte_size >= 0)',
      );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
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
  const ownerFingerprint = config.ownerAccessKeyHash ?? 'disabled';
  const storedOwner = db
    .prepare("SELECT value FROM service_metadata WHERE key = 'owner-auth-fingerprint'")
    .get();
  if (!storedOwner) {
    db.prepare("INSERT INTO service_metadata (key, value) VALUES ('owner-auth-fingerprint', ?)").run(
      ownerFingerprint,
    );
  } else if (storedOwner.value !== ownerFingerprint) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM owner_sessions').run();
      db.prepare('DELETE FROM owner_login_throttle').run();
      db.prepare("UPDATE service_metadata SET value = ? WHERE key = 'owner-auth-fingerprint'").run(
        ownerFingerprint,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return db;
}
