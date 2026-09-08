import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const integer = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

function ownerAccessKeyHash(root, override) {
  if (override !== undefined) {
    if (override !== null && !/^[a-f0-9]{64}$/u.test(override))
      throw new Error('ownerAccessKeyHash must be a lowercase SHA-256 hex digest.');
    return override ?? undefined;
  }
  const hashPath = path.resolve(root, 'owner-access-key.sha256');
  if (path.dirname(hashPath) !== root)
    throw new Error('The owner access-key hash file must remain inside the private data directory.');
  let value;
  try {
    const stat = fs.lstatSync(hashPath);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('The owner access-key hash path must be a regular file.');
    value = fs.readFileSync(hashPath, 'utf8').trim();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    value = process.env.IMNOTA_OWNER_ACCESS_KEY_SHA256?.trim();
  }
  if (value === undefined || value === '') return undefined;
  if (!/^[a-f0-9]{64}$/u.test(value))
    throw new Error('The owner access-key hash must be a lowercase SHA-256 hex digest.');
  return value;
}

export function loadConfig(overrides = {}) {
  const root = path.resolve(
    overrides.dataDir ?? process.env.IMNOTA_SHARE_DATA_DIR ?? path.join(os.homedir(), '.imnota-shares'),
  );
  const configuredOrigin =
    overrides.publicOrigin ?? process.env.IMNOTA_SHARE_PUBLIC_ORIGIN ?? 'https://app.imnota.xyz';
  const parsedOrigin = new URL(configuredOrigin);
  if (
    !['http:', 'https:'].includes(parsedOrigin.protocol) ||
    parsedOrigin.origin !== configuredOrigin.replace(/\/$/, '')
  ) {
    throw new Error('IMNOTA_SHARE_PUBLIC_ORIGIN must be an http(s) origin without a path.');
  }
  const publicOrigin = parsedOrigin.origin;
  const configuredOwnerAccessKeyHash = ownerAccessKeyHash(root, overrides.ownerAccessKeyHash);
  const receiptSecret = overrides.receiptSecret ?? process.env.IMNOTA_SHARE_RECEIPT_SECRET;
  if (
    typeof receiptSecret !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/u.test(receiptSecret) ||
    Buffer.from(receiptSecret, 'base64url').length !== 32
  ) {
    throw new Error('IMNOTA_SHARE_RECEIPT_SECRET must be a base64url-encoded 32-byte server secret.');
  }

  return {
    port: integer(overrides.port ?? process.env.PORT, 3000),
    publicOrigin,
    allowedPairingOrigins: overrides.allowedPairingOrigins ?? [publicOrigin],
    dataDir: root,
    databasePath: path.join(root, 'shares.sqlite'),
    uploadsDir: path.join(root, 'uploads'),
    backupsDir: path.join(root, 'backups'),
    pairingTtlMs: integer(overrides.pairingTtlMs ?? process.env.IMNOTA_SHARE_PAIRING_TTL_MS, 10 * 60 * 1000),
    receiptRecoveryMs: integer(
      overrides.receiptRecoveryMs ?? process.env.IMNOTA_SHARE_RECEIPT_RECOVERY_MS,
      24 * 60 * 60 * 1000,
    ),
    receiptSecret,
    ownerAccessKeyHash: configuredOwnerAccessKeyHash,
    ownerSessionAbsoluteMs: integer(
      overrides.ownerSessionAbsoluteMs ?? process.env.IMNOTA_OWNER_SESSION_ABSOLUTE_MS,
      8 * 60 * 60 * 1000,
    ),
    ownerSessionIdleMs: integer(
      overrides.ownerSessionIdleMs ?? process.env.IMNOTA_OWNER_SESSION_IDLE_MS,
      30 * 60 * 1000,
    ),
    ownerLoginThrottleWindowMs: integer(
      overrides.ownerLoginThrottleWindowMs ?? process.env.IMNOTA_OWNER_LOGIN_THROTTLE_WINDOW_MS,
      15 * 60 * 1000,
    ),
    ownerLoginThrottleLimit: integer(
      overrides.ownerLoginThrottleLimit ?? process.env.IMNOTA_OWNER_LOGIN_THROTTLE_LIMIT,
      100,
    ),
    defaultExpiryDays: integer(
      overrides.defaultExpiryDays ?? process.env.IMNOTA_SHARE_DEFAULT_EXPIRY_DAYS,
      1,
    ),
    maxExpiryDays: integer(overrides.maxExpiryDays ?? process.env.IMNOTA_SHARE_MAX_EXPIRY_DAYS, 30),
    cleanupGraceMs: integer(
      overrides.cleanupGraceMs ?? process.env.IMNOTA_SHARE_CLEANUP_GRACE_MS,
      24 * 60 * 60 * 1000,
    ),
    cleanupIntervalMs: integer(
      overrides.cleanupIntervalMs ?? process.env.IMNOTA_SHARE_CLEANUP_INTERVAL_MS,
      60 * 60 * 1000,
    ),
    backupIntervalMs: integer(
      overrides.backupIntervalMs ?? process.env.IMNOTA_SHARE_BACKUP_INTERVAL_MS,
      24 * 60 * 60 * 1000,
    ),
    backupRetentionMs: Math.min(
      integer(
        overrides.backupRetentionMs ?? process.env.IMNOTA_SHARE_BACKUP_RETENTION_MS,
        31 * 24 * 60 * 60 * 1000,
      ),
      31 * 24 * 60 * 60 * 1000,
    ),
    maxMarkdownBytes: integer(
      overrides.maxMarkdownBytes ?? process.env.IMNOTA_SHARE_MAX_MARKDOWN_BYTES,
      1024 * 1024,
    ),
    maxImageBytes: integer(
      overrides.maxImageBytes ?? process.env.IMNOTA_SHARE_MAX_IMAGE_BYTES,
      10 * 1024 * 1024,
    ),
    maxImages: integer(overrides.maxImages ?? process.env.IMNOTA_SHARE_MAX_IMAGES, 20),
    maxBundleBytes: integer(
      overrides.maxBundleBytes ?? process.env.IMNOTA_SHARE_MAX_BUNDLE_BYTES,
      25 * 1024 * 1024,
    ),
    maxImageDimension: integer(
      overrides.maxImageDimension ?? process.env.IMNOTA_SHARE_MAX_IMAGE_DIMENSION,
      10_000,
    ),
    maxImagePixels: integer(
      overrides.maxImagePixels ?? process.env.IMNOTA_SHARE_MAX_IMAGE_PIXELS,
      16_000_000,
    ),
    maxInflatedPngBytes: integer(
      overrides.maxInflatedPngBytes ?? process.env.IMNOTA_SHARE_MAX_INFLATED_PNG_BYTES,
      64 * 1024 * 1024,
    ),
    maxBundleImagePixels: integer(
      overrides.maxBundleImagePixels ?? process.env.IMNOTA_SHARE_MAX_BUNDLE_IMAGE_PIXELS,
      64_000_000,
    ),
    maxBundleInflatedPngBytes: integer(
      overrides.maxBundleInflatedPngBytes ?? process.env.IMNOTA_SHARE_MAX_BUNDLE_INFLATED_PNG_BYTES,
      256 * 1024 * 1024,
    ),
    maxStorageBytes: integer(
      overrides.maxStorageBytes ?? process.env.IMNOTA_SHARE_MAX_STORAGE_BYTES,
      2 * 1024 * 1024 * 1024,
    ),
    maxConcurrentUploads: integer(
      overrides.maxConcurrentUploads ?? process.env.IMNOTA_SHARE_MAX_CONCURRENT_UPLOADS,
      4,
    ),
    jsonLimit: overrides.jsonLimit ?? process.env.IMNOTA_SHARE_JSON_LIMIT ?? '36mb',
    trustProxy: overrides.trustProxy ?? process.env.IMNOTA_SHARE_TRUST_PROXY ?? 'loopback',
    rateLimits: {
      pairing: overrides.rateLimits?.pairing ?? { windowMs: 15 * 60 * 1000, limit: 10 },
      upload: overrides.rateLimits?.upload ?? { windowMs: 15 * 60 * 1000, limit: 20 },
      publicRead: overrides.rateLimits?.publicRead ?? { windowMs: 60 * 1000, limit: 120 },
      ownerLogin: overrides.rateLimits?.ownerLogin ?? { windowMs: 15 * 60 * 1000, limit: 10 },
      ownerApi: overrides.rateLimits?.ownerApi ?? { windowMs: 60 * 1000, limit: 120 },
    },
  };
}
