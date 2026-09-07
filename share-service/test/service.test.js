import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import zlib from 'node:zlib';
import request from 'supertest';
import { createService } from '../src/app.js';
import { cleanupExpired, reconcileArtifacts } from '../src/maintenance.js';
import { backupMetadata } from '../src/metadata-backup.js';
import { randomToken, tokenHash } from '../src/security.js';

const origin = 'https://app.imnota.xyz';
const receiptSecret = Buffer.alloc(32, 7).toString('base64url');
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const metaCspDirectives = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'self'",
];

function assertMetaCsp(html) {
  const charsetAt = html.indexOf('charset="utf-8"');
  const policyAt = html.indexOf('http-equiv="Content-Security-Policy"');
  const firstResourceAt = Math.min(
    ...['<script', '<link'].map((tag) => {
      const index = html.indexOf(tag);
      return index < 0 ? Number.POSITIVE_INFINITY : index;
    }),
  );
  assert.ok(charsetAt >= 0 && policyAt > charsetAt && policyAt < firstResourceAt);
  for (const directive of metaCspDirectives) assert.ok(html.includes(directive), directive);
}

const testCrcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function testCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = testCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  result.write(type, 4, 4, 'ascii');
  data.copy(result, 8);
  result.writeUInt32BE(testCrc32(result.subarray(4, 8 + data.length)), 8 + data.length);
  return result;
}

function craftedPng(width, height, inflatedData, { depth = 8, colorType = 6 } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = colorType;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(inflatedData)),
    pngChunk('IEND'),
  ]);
}

async function fixture(options = {}) {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'imnota-share-test-'));
  let clock = Date.UTC(2026, 8, 8, 12);
  const service = createService({
    dataDir,
    publicOrigin: origin,
    receiptSecret,
    now: () => clock,
    rateLimits: {
      pairing: { windowMs: 60_000, limit: 1_000 },
      upload: { windowMs: 60_000, limit: 1_000 },
      publicRead: { windowMs: 60_000, limit: 1_000 },
    },
    ...options,
  });
  return {
    ...service,
    api: request(service.app),
    advance(ms) {
      clock += ms;
    },
    async destroy() {
      service.close();
      await fsp.rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function pair(instance) {
  const response = await instance.api.post('/api/pairing').set('Origin', origin).send({}).expect(201);
  return response.body.uploadToken;
}

async function share(instance, overrides = {}) {
  const uploadToken = await pair(instance);
  const body = {
    requestId: randomUUID(),
    title: 'Collection one',
    markdown: '# Safe heading\n\nHello **world**.',
    images: [{ filename: 'prompt-001.png', dataBase64: onePixelPng.toString('base64') }],
    includeArchive: true,
    ...overrides,
  };
  return instance.api.post('/api/shares').set('Authorization', `Bearer ${uploadToken}`).send(body);
}

test('health and pairing pages use restrictive security headers', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  const health = await instance.api.get('/health').expect(200);
  assert.deepEqual(health.body, { status: 'ok', storageBytes: 0, recordedBytes: 0, reservedBytes: 0 });
  assert.equal(health.headers['x-powered-by'], undefined);
  assert.match(health.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(health.headers['content-security-policy'], /connect-src 'self'/);
  assert.match(health.headers['content-security-policy'], /frame-src 'none'/);
  assert.equal(health.headers['x-frame-options'], 'DENY');
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  const page = await instance.api.get('/new').expect(200);
  assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow');
  assertMetaCsp(page.text);
});

test('pairing requires the configured browser origin and issues high-entropy hashed tokens', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  await instance.api
    .post('/api/pairing')
    .send({})
    .expect(403)
    .expect(({ body }) => {
      assert.equal(body.error.code, 'origin_denied');
    });
  const response = await instance.api.post('/api/pairing').set('Origin', origin).send({}).expect(201);
  assert.match(response.body.uploadToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(response.body.uploadToken, 'base64url').length, 32);
  const row = instance.db
    .prepare('SELECT token_hash FROM pairings WHERE id = ?')
    .get(response.body.pairingId);
  assert.equal(row.token_hash, tokenHash(response.body.uploadToken));
  assert.equal(JSON.stringify(row).includes(response.body.uploadToken), false);
  assert.equal(new Set(Array.from({ length: 100 }, randomToken)).size, 100);
});

test('creates, renders and downloads only controlled finalized artifacts', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  const created = await share(instance, {
    title: '<img src=x onerror=alert(1)>',
    markdown: '# Heading\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(2))',
  });
  assert.equal(created.status, 201, created.text);
  assert.match(created.body.url, /^https:\/\/app\.imnota\.xyz\/s\/[A-Za-z0-9_-]{43}$/);
  assert.match(created.body.managementToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(created.body.managementToken, created.body.url.split('/').at(-1));
  const publicToken = created.body.url.split('/').at(-1);
  const database = fs.readFileSync(instance.config.databasePath);
  assert.equal(database.includes(Buffer.from(publicToken)), false);
  assert.equal(database.includes(Buffer.from(created.body.managementToken)), false);

  const page = await instance.api.get(`/s/${publicToken}`).expect(200);
  assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(page.headers['cache-control'], 'private, no-store');
  assert.doesNotMatch(page.text, /<script>alert/);
  assert.doesNotMatch(page.text, /<img src=x/);
  assert.doesNotMatch(page.text, /href="javascript:/);
  assert.match(page.text, /Available until/);
  assertMetaCsp(page.text);

  const markdown = await instance.api.get(`/s/${publicToken}/markdown`).expect(200);
  assert.match(markdown.headers['content-type'], /^text\/markdown/);
  assert.equal(markdown.headers['content-disposition'], 'attachment; filename="prompt.md"');
  const image = await instance.api.get(`/s/${publicToken}/assets/prompt-001.png`).expect(200);
  assert.match(image.headers['content-type'], /^image\/png/);
  assert.equal(image.headers['x-content-type-options'], 'nosniff');
  const zip = await instance.api
    .get(`/s/${publicToken}/archive.zip`)
    .buffer(true)
    .parse((response, callback) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  assert.match(zip.headers['content-type'], /^application\/zip/);
  assert.equal(zip.body.subarray(0, 2).toString(), 'PK');
});

test('fully validates, bounds, and re-encodes PNGs before private storage', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  const truncated = onePixelPng.subarray(0, 33);
  const badCrc = Buffer.from(onePixelPng);
  badCrc[29] ^= 1;
  const trailing = Buffer.concat([onePixelPng, Buffer.from('<script>')]);
  const bomb = craftedPng(1, 1, Buffer.alloc(1024 * 1024));
  const oversizedArea = craftedPng(4_001, 4_000, Buffer.alloc(1));
  for (const [name, data] of [
    ['truncated.png', truncated],
    ['bad-crc.png', badCrc],
    ['trailing.png', trailing],
    ['compression-bomb.png', bomb],
    ['oversized-area.png', oversizedArea],
  ]) {
    const uploadToken = await pair(instance);
    await instance.api
      .post('/api/shares')
      .set('Authorization', `Bearer ${uploadToken}`)
      .send({
        requestId: randomUUID(),
        title: name,
        markdown: '',
        images: [{ filename: name, dataBase64: data.toString('base64') }],
      })
      .expect(400)
      .expect(({ body }) => assert.equal(body.error.code, 'invalid_request'));
  }

  const privateText = Buffer.from('Comment\0C:\\Users\\Dylan\\private-project', 'latin1');
  const withAncillary = Buffer.concat([
    onePixelPng.subarray(0, onePixelPng.length - 12),
    pngChunk('tEXt', privateText),
    onePixelPng.subarray(onePixelPng.length - 12),
  ]);
  const normalized = await share(instance, {
    requestId: randomUUID(),
    images: [{ filename: 'native-export.png', dataBase64: withAncillary.toString('base64') }],
    includeArchive: false,
  });
  assert.equal(normalized.status, 201, normalized.text);
  const stored = await fsp.readFile(
    path.join(instance.config.uploadsDir, normalized.body.id, 'native-export.png'),
  );
  assert.equal(stored.includes(Buffer.from('private-project')), false);
  assert.ok(stored.length > 40);
  const token = normalized.body.url.split('/').at(-1);
  await instance.api.get(`/s/${token}/assets/native-export.png`).expect(200);
});

test('rejects aggregate PNG work before decoding an excessive bundle', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  const scanlineBytes = (Math.ceil(4_000 / 8) + 1) * 4_000;
  const validSixteenMegapixelPng = craftedPng(4_000, 4_000, Buffer.alloc(scanlineBytes), {
    depth: 1,
    colorType: 0,
  });
  const uploadToken = await pair(instance);
  await instance.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${uploadToken}`)
    .send({
      requestId: randomUUID(),
      title: 'Too many large images',
      markdown: '',
      images: Array.from({ length: 5 }, (_, index) => ({
        filename: `large-${index}.png`,
        dataBase64: validSixteenMegapixelPng.toString('base64'),
      })),
    })
    .expect(413)
    .expect(({ body }) => {
      assert.equal(body.error.code, 'payload_too_large');
      assert.match(body.error.message, /64000000 pixel/);
    });

  const inflatedLimited = await fixture({ maxBundleInflatedPngBytes: 5 });
  t.after(() => inflatedLimited.destroy());
  const secondToken = await pair(inflatedLimited);
  await inflatedLimited.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${secondToken}`)
    .send({
      requestId: randomUUID(),
      title: 'Too much scanline data',
      markdown: '',
      images: [0, 1].map((index) => ({
        filename: `pixel-${index}.png`,
        dataBase64: onePixelPng.toString('base64'),
      })),
    })
    .expect(413)
    .expect(({ body }) => {
      assert.equal(body.error.code, 'payload_too_large');
      assert.match(body.error.message, /inflated PNG memory/);
    });
});

test('a server-only receipt secret prevents offline token derivation from an expired pairing bearer', async (t) => {
  const instance = await fixture({ receiptRecoveryMs: 1_000, pairingTtlMs: 500 });
  t.after(() => instance.destroy());
  const uploadToken = await pair(instance);
  const requestId = randomUUID();
  const created = await instance.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${uploadToken}`)
    .send({
      requestId,
      title: 'Secret-bound',
      markdown: '',
      images: [],
    })
    .expect(201);
  const obsoleteBearerOnlyGuess = createHmac('sha256', uploadToken)
    .update(`imnota-share-v1:public:${requestId}`)
    .digest('base64url');
  assert.notEqual(obsoleteBearerOnlyGuess, created.body.url.split('/').at(-1));
  const row = instance.db
    .prepare('SELECT public_token_hash, management_token_hash FROM shares WHERE id = ?')
    .get(created.body.id);
  assert.equal(row.public_token_hash, tokenHash(created.body.url.split('/').at(-1)));
  assert.equal(row.management_token_hash, tokenHash(created.body.managementToken));
  instance.advance(1_001);
  await instance.api
    .get(`/api/shares/receipt/${requestId}`)
    .set('Authorization', `Bearer ${uploadToken}`)
    .expect(410);
  assert.throws(
    () =>
      createService({ dataDir: instance.config.dataDir, publicOrigin: origin, receiptSecret: 'too-short' }),
    /32-byte server secret/,
  );
});

test('concurrent identical POSTs create one share and recover one receipt', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  const uploadToken = await pair(instance);
  const upload = { requestId: randomUUID(), title: 'Concurrent', markdown: 'same', images: [] };
  const [left, right] = await Promise.all([
    instance.api.post('/api/shares').set('Authorization', `Bearer ${uploadToken}`).send(upload),
    instance.api.post('/api/shares').set('Authorization', `Bearer ${uploadToken}`).send(upload),
  ]);
  assert.deepEqual([left.status, right.status].sort(), [200, 201]);
  assert.equal(left.body.id, right.body.id);
  assert.equal(left.body.url, right.body.url);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS count FROM shares').get().count, 1);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS count FROM staging_uploads').get().count, 0);
});

test('startup reconciliation removes crash artifacts and reservations while preserving active shares', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  const active = await share(instance, { images: [], includeArchive: false });
  assert.equal(active.status, 201, active.text);
  const crashId = randomUUID();
  const unknownId = randomUUID();
  instance.db
    .prepare(
      'INSERT INTO staging_uploads (id, upload_token_hash, request_id, payload_hash, created_at, reserved_bytes) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(crashId, tokenHash(randomToken()), randomUUID(), 'a'.repeat(64), Date.UTC(2026, 8, 8, 12), 4096);
  await fsp.mkdir(path.join(instance.config.uploadsDir, crashId));
  await fsp.writeFile(path.join(instance.config.uploadsDir, crashId, 'orphan.bin'), Buffer.alloc(37));
  await fsp.mkdir(path.join(instance.config.uploadsDir, `.staging-${unknownId}`));
  await fsp.writeFile(
    path.join(instance.config.uploadsDir, `.staging-${unknownId}`, 'orphan.bin'),
    Buffer.alloc(23),
  );
  const before = await instance.api.get('/health').expect(200);
  assert.ok(before.body.storageBytes > before.body.recordedBytes);
  assert.equal(before.body.reservedBytes, 4096);

  const result = await reconcileArtifacts({ db: instance.db, config: instance.config, aggressive: true });
  assert.ok(result.deletedDirectories >= 2);
  assert.equal(result.deletedReservations, 1);
  assert.equal(fs.existsSync(path.join(instance.config.uploadsDir, active.body.id)), true);
  assert.equal(fs.existsSync(path.join(instance.config.uploadsDir, crashId)), false);
  assert.equal(fs.existsSync(path.join(instance.config.uploadsDir, `.staging-${unknownId}`)), false);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS count FROM staging_uploads').get().count, 0);
  const activeToken = active.body.url.split('/').at(-1);
  await instance.api.get(`/s/${activeToken}`).expect(200);
});

test('creates consistent private SQLite backups and prunes retention-expired copies', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  const active = await share(instance, { images: [], includeArchive: false });
  assert.equal(active.status, 201, active.text);
  const first = await backupMetadata({ db: instance.db, config: instance.config, now: Date.UTC(2026, 8, 8) });
  const firstPath = path.join(instance.config.backupsDir, first.filename);
  const staleTime = new Date(Date.UTC(2026, 6, 1));
  await fsp.utimes(firstPath, staleTime, staleTime);
  const second = await backupMetadata({
    db: instance.db,
    config: instance.config,
    now: Date.UTC(2026, 8, 8),
  });
  assert.equal(second.deletedBackups, 1);
  assert.equal(fs.existsSync(firstPath), false);
  const secondPath = path.join(instance.config.backupsDir, second.filename);
  const restored = new DatabaseSync(secondPath, { readOnly: true });
  assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM shares').get().count, 1);
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  restored.close();
  const entries = await fsp.readdir(instance.config.backupsDir);
  assert.deepEqual(entries, [second.filename]);
});

test('pairing is one logical upload, supports receipt recovery, and management revokes only its share', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  const uploadToken = await pair(instance);
  const upload = {
    requestId: randomUUID(),
    title: 'First',
    markdown: 'Text',
    images: [],
  };
  const first = await instance.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${uploadToken}`)
    .send(upload)
    .expect(201);
  assert.equal(first.body.recovered, false);
  const replay = await instance.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${uploadToken}`)
    .send(upload)
    .expect(200);
  assert.equal(replay.body.recovered, true);
  assert.equal(replay.body.id, first.body.id);
  assert.equal(replay.body.url, first.body.url);
  assert.equal(replay.body.managementToken, first.body.managementToken);
  await instance.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${uploadToken}`)
    .send({
      ...upload,
      markdown: 'Changed',
    })
    .expect(409)
    .expect(({ body }) => assert.equal(body.error.code, 'idempotency_conflict'));

  const receipt = await instance.api
    .get(`/api/shares/receipt/${upload.requestId}`)
    .set('Authorization', `Bearer ${uploadToken}`)
    .expect(200);
  assert.equal(receipt.body.recovered, true);
  assert.equal(receipt.body.managementToken, first.body.managementToken);
  instance.db.prepare('DELETE FROM pairings WHERE token_hash = ?').run(tokenHash(uploadToken));
  await instance.api
    .get(`/api/shares/receipt/${upload.requestId}`)
    .set('Authorization', `Bearer ${uploadToken}`)
    .expect(200);
  await instance.api
    .get(`/api/shares/receipt/${randomUUID()}`)
    .set('Authorization', `Bearer ${uploadToken}`)
    .expect(404)
    .expect(({ body }) => assert.equal(body.error.code, 'receipt_not_found'));
  await instance.api
    .get(`/api/shares/receipt/${upload.requestId}`)
    .set('Authorization', `Bearer ${randomToken()}`)
    .expect(401);

  const listing = await instance.api
    .get('/api/shares')
    .set('Authorization', `Bearer ${first.body.managementToken}`)
    .expect(200);
  assert.equal(listing.body.shares.length, 1);
  assert.equal(listing.body.shares[0].id, first.body.id);
  assert.equal(listing.body.shares[0].url, null);
  await instance.api
    .post(`/api/shares/not-${first.body.id}/revoke`)
    .set('Authorization', `Bearer ${first.body.managementToken}`)
    .expect(404);
  await instance.api
    .post(`/api/shares/${first.body.id}/revoke`)
    .set('Authorization', `Bearer ${randomToken()}`)
    .expect(401);
  const revoked = await instance.api
    .post(`/api/shares/${first.body.id}/revoke`)
    .set('Authorization', `Bearer ${first.body.managementToken}`)
    .expect(200);
  assert.ok(revoked.body.revokedAt);
  const token = first.body.url.split('/').at(-1);
  const unavailable = await instance.api
    .get(`/s/${token}`)
    .expect(404)
    .expect(({ text }) => assert.match(text, /expired, or was revoked/));
  assertMetaCsp(unavailable.text);
  const repeated = await instance.api
    .post(`/api/shares/${first.body.id}/revoke`)
    .set('Authorization', `Bearer ${first.body.managementToken}`)
    .expect(200);
  assert.equal(repeated.body.revokedAt, revoked.body.revokedAt);
});

test('expired shares are unavailable and cleanup removes only records beyond grace', async (t) => {
  const instance = await fixture({ cleanupGraceMs: 1_000 });
  t.after(() => instance.destroy());
  const created = await share(instance, { images: [], includeArchive: false, expiresInDays: 1 });
  assert.equal(created.status, 201, created.text);
  const token = created.body.url.split('/').at(-1);
  instance.advance(24 * 60 * 60 * 1000 + 1);
  await instance.api.get(`/s/${token}`).expect(404);
  let cleanup = await cleanupExpired({
    db: instance.db,
    config: instance.config,
    now: Date.UTC(2026, 8, 9, 12, 0, 0, 1),
  });
  assert.equal(cleanup.deletedShares, 0);
  instance.advance(1_001);
  cleanup = await cleanupExpired({
    db: instance.db,
    config: instance.config,
    now: Date.UTC(2026, 8, 9, 12, 0, 1, 2),
  });
  assert.equal(cleanup.deletedShares, 1);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS count FROM shares').get().count, 0);
});

test('receipt recovery is bounded independently from share expiry', async (t) => {
  const instance = await fixture({ receiptRecoveryMs: 1_000 });
  t.after(() => instance.destroy());
  const uploadToken = await pair(instance);
  const upload = { requestId: randomUUID(), title: 'Recover once', markdown: 'Text', images: [] };
  await instance.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${uploadToken}`)
    .send(upload)
    .expect(201);
  instance.advance(1_001);
  await instance.api
    .get(`/api/shares/receipt/${upload.requestId}`)
    .set('Authorization', `Bearer ${uploadToken}`)
    .expect(410)
    .expect(({ body }) => assert.equal(body.error.code, 'recovery_expired'));
  await instance.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${uploadToken}`)
    .send(upload)
    .expect(410)
    .expect(({ body }) => assert.equal(body.error.code, 'recovery_expired'));
});

test('rejects expired pairing, unsafe names, non-PNG data, oversized content and invalid expiry', async (t) => {
  const instance = await fixture({
    pairingTtlMs: 1_000,
    maxMarkdownBytes: 8,
    maxBundleBytes: 64,
    maxImageBytes: 48,
  });
  t.after(() => instance.destroy());
  const expiredToken = await pair(instance);
  instance.advance(1_001);
  await instance.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${expiredToken}`)
    .send({ requestId: randomUUID(), title: 'Late', markdown: '', images: [] })
    .expect(401)
    .expect(({ body }) => assert.equal(body.error.code, 'pairing_expired'));

  const cases = [
    {
      requestId: randomUUID(),
      title: 'Unsafe',
      markdown: '',
      images: [{ filename: '../secret.png', dataBase64: onePixelPng.toString('base64') }],
    },
    {
      requestId: randomUUID(),
      title: 'Wrong type',
      markdown: '',
      images: [{ filename: 'safe.png', dataBase64: Buffer.from('<script>').toString('base64') }],
    },
    { requestId: randomUUID(), title: 'Too much', markdown: '123456789', images: [] },
    { requestId: randomUUID(), title: 'Forever', markdown: '', images: [], expiresInDays: 31 },
  ];
  for (const body of cases) {
    const token = await pair(instance);
    const response = await instance.api
      .post('/api/shares')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    assert.ok([400, 413].includes(response.status), response.text);
  }
  await instance.api.get('/s/sequential-id').expect(404);
  await instance.api.get('/s/not-a-token/assets/%2e%2e%2fshares.sqlite').expect(404);
});

test('enforces service quota, request limits and endpoint rate limits with stable error shapes', async (t) => {
  const limited = await fixture({
    maxStorageBytes: 2,
    jsonLimit: '200b',
    rateLimits: {
      pairing: { windowMs: 60_000, limit: 1 },
      upload: { windowMs: 60_000, limit: 100 },
      publicRead: { windowMs: 60_000, limit: 100 },
    },
  });
  t.after(() => limited.destroy());
  const token = await pair(limited);
  await limited.api
    .post('/api/pairing')
    .set('Origin', origin)
    .send({})
    .expect(429)
    .expect(({ body }) => {
      assert.equal(body.error.code, 'rate_limited');
    });
  await limited.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${token}`)
    .send({ requestId: randomUUID(), title: 'Quota', markdown: 'abc', images: [] })
    .expect(507)
    .expect(({ body }) => assert.equal(body.error.code, 'quota_exceeded'));

  const bodyLimited = await fixture({ jsonLimit: '80b' });
  t.after(() => bodyLimited.destroy());
  const secondToken = await pair(bodyLimited);
  await bodyLimited.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${secondToken}`)
    .send({ requestId: randomUUID(), title: 'Body', markdown: 'x'.repeat(100), images: [] })
    .expect(413)
    .expect(({ body }) => assert.equal(body.error.code, 'payload_too_large'));
  await bodyLimited.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${secondToken}`)
    .set('Content-Type', 'application/json')
    .send('{')
    .expect(400)
    .expect(({ body }) => assert.equal(body.error.code, 'invalid_request'));

  const filesystemLimited = await fixture({ maxStorageBytes: 50 });
  t.after(() => filesystemLimited.destroy());
  const untrackedDirectory = path.join(filesystemLimited.config.uploadsDir, randomUUID());
  await fsp.mkdir(untrackedDirectory);
  await fsp.writeFile(path.join(untrackedDirectory, 'crash.bin'), Buffer.alloc(49));
  const filesystemToken = await pair(filesystemLimited);
  await filesystemLimited.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${filesystemToken}`)
    .send({
      requestId: randomUUID(),
      title: 'Actual usage',
      markdown: 'xx',
      images: [],
    })
    .expect(507)
    .expect(({ body }) => assert.equal(body.error.code, 'quota_exceeded'));

  const parserLimited = await fixture({
    jsonLimit: '80b',
    rateLimits: {
      pairing: { windowMs: 60_000, limit: 100 },
      upload: { windowMs: 60_000, limit: 1 },
      publicRead: { windowMs: 60_000, limit: 100 },
    },
  });
  t.after(() => parserLimited.destroy());
  await parserLimited.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${randomToken()}`)
    .send({})
    .expect(401);
  await parserLimited.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${randomToken()}`)
    .send({ padding: 'x'.repeat(200) })
    .expect(429)
    .expect(({ body }) => assert.equal(body.error.code, 'rate_limited'));

  const publicLimited = await fixture({
    rateLimits: {
      pairing: { windowMs: 60_000, limit: 100 },
      upload: { windowMs: 60_000, limit: 100 },
      publicRead: { windowMs: 60_000, limit: 1 },
    },
  });
  t.after(() => publicLimited.destroy());
  await publicLimited.api.get('/new').expect(200);
  await publicLimited.api
    .get(`/s/${randomToken()}`)
    .expect(429)
    .expect(({ body }) => {
      assert.equal(body.error.code, 'rate_limited');
    });
});
