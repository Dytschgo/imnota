import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createService } from '../src/app.js';
import { cleanupExpired } from '../src/maintenance.js';
import { randomToken, tokenHash } from '../src/security.js';

const origin = 'https://app.imnota.xyz';
const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function fixture(options = {}) {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'imnota-share-test-'));
  let clock = Date.UTC(2026, 8, 8, 12);
  const service = createService({
    dataDir,
    publicOrigin: origin,
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
    advance(ms) { clock += ms; },
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
  assert.deepEqual(health.body, { status: 'ok', storageBytes: 0 });
  assert.equal(health.headers['x-powered-by'], undefined);
  assert.match(health.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(health.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  const page = await instance.api.get('/new').expect(200);
  assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow');
});

test('pairing requires the configured browser origin and issues high-entropy hashed tokens', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  await instance.api.post('/api/pairing').send({}).expect(403).expect(({ body }) => {
    assert.equal(body.error.code, 'origin_denied');
  });
  const response = await instance.api.post('/api/pairing').set('Origin', origin).send({}).expect(201);
  assert.match(response.body.uploadToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(response.body.uploadToken, 'base64url').length, 32);
  const row = instance.db.prepare('SELECT token_hash FROM pairings WHERE id = ?').get(response.body.pairingId);
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

  const markdown = await instance.api.get(`/s/${publicToken}/markdown`).expect(200);
  assert.match(markdown.headers['content-type'], /^text\/markdown/);
  assert.equal(markdown.headers['content-disposition'], 'attachment; filename="prompt.md"');
  const image = await instance.api.get(`/s/${publicToken}/assets/prompt-001.png`).expect(200);
  assert.match(image.headers['content-type'], /^image\/png/);
  assert.equal(image.headers['x-content-type-options'], 'nosniff');
  const zip = await instance.api.get(`/s/${publicToken}/archive.zip`).buffer(true).parse((response, callback) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => callback(null, Buffer.concat(chunks)));
  }).expect(200);
  assert.match(zip.headers['content-type'], /^application\/zip/);
  assert.equal(zip.body.subarray(0, 2).toString(), 'PK');
});

test('pairing is one logical upload, supports receipt recovery, and management revokes only its share', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  const uploadToken = await pair(instance);
  const upload = {
    requestId: randomUUID(), title: 'First', markdown: 'Text', images: [],
  };
  const first = await instance.api.post('/api/shares').set('Authorization', `Bearer ${uploadToken}`).send(upload)
    .expect(201);
  assert.equal(first.body.recovered, false);
  const replay = await instance.api.post('/api/shares').set('Authorization', `Bearer ${uploadToken}`).send(upload)
    .expect(200);
  assert.equal(replay.body.recovered, true);
  assert.equal(replay.body.id, first.body.id);
  assert.equal(replay.body.url, first.body.url);
  assert.equal(replay.body.managementToken, first.body.managementToken);
  await instance.api.post('/api/shares').set('Authorization', `Bearer ${uploadToken}`).send({
    ...upload, markdown: 'Changed',
  }).expect(409).expect(({ body }) => assert.equal(body.error.code, 'idempotency_conflict'));

  const receipt = await instance.api.get(`/api/shares/receipt/${upload.requestId}`).set('Authorization', `Bearer ${uploadToken}`)
    .expect(200);
  assert.equal(receipt.body.recovered, true);
  assert.equal(receipt.body.managementToken, first.body.managementToken);
  instance.db.prepare('DELETE FROM pairings WHERE token_hash = ?').run(tokenHash(uploadToken));
  await instance.api.get(`/api/shares/receipt/${upload.requestId}`).set('Authorization', `Bearer ${uploadToken}`)
    .expect(200);
  await instance.api.get(`/api/shares/receipt/${randomUUID()}`).set('Authorization', `Bearer ${uploadToken}`)
    .expect(404).expect(({ body }) => assert.equal(body.error.code, 'receipt_not_found'));
  await instance.api.get(`/api/shares/receipt/${upload.requestId}`).set('Authorization', `Bearer ${randomToken()}`)
    .expect(401);

  const listing = await instance.api.get('/api/shares').set('Authorization', `Bearer ${first.body.managementToken}`).expect(200);
  assert.equal(listing.body.shares.length, 1);
  assert.equal(listing.body.shares[0].id, first.body.id);
  assert.equal(listing.body.shares[0].url, null);
  await instance.api.post(`/api/shares/not-${first.body.id}/revoke`).set('Authorization', `Bearer ${first.body.managementToken}`).expect(404);
  await instance.api.post(`/api/shares/${first.body.id}/revoke`).set('Authorization', `Bearer ${randomToken()}`).expect(401);
  const revoked = await instance.api.post(`/api/shares/${first.body.id}/revoke`).set('Authorization', `Bearer ${first.body.managementToken}`).expect(200);
  assert.ok(revoked.body.revokedAt);
  const token = first.body.url.split('/').at(-1);
  await instance.api.get(`/s/${token}`).expect(404).expect(({ text }) => assert.match(text, /expired, or was revoked/));
  const repeated = await instance.api.post(`/api/shares/${first.body.id}/revoke`).set('Authorization', `Bearer ${first.body.managementToken}`).expect(200);
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
  let cleanup = await cleanupExpired({ db: instance.db, config: instance.config, now: Date.UTC(2026, 8, 9, 12, 0, 0, 1) });
  assert.equal(cleanup.deletedShares, 0);
  instance.advance(1_001);
  cleanup = await cleanupExpired({ db: instance.db, config: instance.config, now: Date.UTC(2026, 8, 9, 12, 0, 1, 2) });
  assert.equal(cleanup.deletedShares, 1);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS count FROM shares').get().count, 0);
});

test('receipt recovery is bounded independently from share expiry', async (t) => {
  const instance = await fixture({ receiptRecoveryMs: 1_000 });
  t.after(() => instance.destroy());
  const uploadToken = await pair(instance);
  const upload = { requestId: randomUUID(), title: 'Recover once', markdown: 'Text', images: [] };
  await instance.api.post('/api/shares').set('Authorization', `Bearer ${uploadToken}`).send(upload).expect(201);
  instance.advance(1_001);
  await instance.api.get(`/api/shares/receipt/${upload.requestId}`).set('Authorization', `Bearer ${uploadToken}`)
    .expect(410).expect(({ body }) => assert.equal(body.error.code, 'recovery_expired'));
  await instance.api.post('/api/shares').set('Authorization', `Bearer ${uploadToken}`).send(upload)
    .expect(410).expect(({ body }) => assert.equal(body.error.code, 'recovery_expired'));
});

test('rejects expired pairing, unsafe names, non-PNG data, oversized content and invalid expiry', async (t) => {
  const instance = await fixture({ pairingTtlMs: 1_000, maxMarkdownBytes: 8, maxBundleBytes: 64, maxImageBytes: 48 });
  t.after(() => instance.destroy());
  const expiredToken = await pair(instance);
  instance.advance(1_001);
  await instance.api.post('/api/shares').set('Authorization', `Bearer ${expiredToken}`).send({ requestId: randomUUID(), title: 'Late', markdown: '', images: [] })
    .expect(401).expect(({ body }) => assert.equal(body.error.code, 'pairing_expired'));

  const cases = [
    { requestId: randomUUID(), title: 'Unsafe', markdown: '', images: [{ filename: '../secret.png', dataBase64: onePixelPng.toString('base64') }] },
    { requestId: randomUUID(), title: 'Wrong type', markdown: '', images: [{ filename: 'safe.png', dataBase64: Buffer.from('<script>').toString('base64') }] },
    { requestId: randomUUID(), title: 'Too much', markdown: '123456789', images: [] },
    { requestId: randomUUID(), title: 'Forever', markdown: '', images: [], expiresInDays: 31 },
  ];
  for (const body of cases) {
    const token = await pair(instance);
    const response = await instance.api.post('/api/shares').set('Authorization', `Bearer ${token}`).send(body);
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
  await limited.api.post('/api/pairing').set('Origin', origin).send({}).expect(429).expect(({ body }) => {
    assert.equal(body.error.code, 'rate_limited');
  });
  await limited.api.post('/api/shares').set('Authorization', `Bearer ${token}`).send({ requestId: randomUUID(), title: 'Quota', markdown: 'abc', images: [] })
    .expect(507).expect(({ body }) => assert.equal(body.error.code, 'quota_exceeded'));

  const bodyLimited = await fixture({ jsonLimit: '80b' });
  t.after(() => bodyLimited.destroy());
  const secondToken = await pair(bodyLimited);
  await bodyLimited.api.post('/api/shares').set('Authorization', `Bearer ${secondToken}`).send({ requestId: randomUUID(), title: 'Body', markdown: 'x'.repeat(100), images: [] })
    .expect(413).expect(({ body }) => assert.equal(body.error.code, 'payload_too_large'));
  await bodyLimited.api.post('/api/shares').set('Authorization', `Bearer ${secondToken}`).set('Content-Type', 'application/json').send('{')
    .expect(400).expect(({ body }) => assert.equal(body.error.code, 'invalid_request'));

  const publicLimited = await fixture({
    rateLimits: {
      pairing: { windowMs: 60_000, limit: 100 },
      upload: { windowMs: 60_000, limit: 100 },
      publicRead: { windowMs: 60_000, limit: 1 },
    },
  });
  t.after(() => publicLimited.destroy());
  await publicLimited.api.get(`/s/${randomToken()}`).expect(404);
  await publicLimited.api.get(`/s/${randomToken()}`).expect(429).expect(({ body }) => {
    assert.equal(body.error.code, 'rate_limited');
  });
});
