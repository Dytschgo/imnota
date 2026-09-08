import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createService } from '../src/app.js';

const origin = 'https://app.imnota.xyz';
const receiptSecret = Buffer.alloc(32, 7).toString('base64url');
const accessKey = randomBytes(32).toString('base64url');
const accessKeyHash = createHash('sha256').update(accessKey).digest('hex');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function fixture(options = {}) {
  const dataDir = options.dataDir ?? (await fsp.mkdtemp(path.join(os.tmpdir(), '.imnota-owner-test-')));
  let clock = Date.UTC(2026, 8, 8, 12);
  const service = createService({
    dataDir,
    publicOrigin: origin,
    receiptSecret,
    ownerAccessKeyHash: accessKeyHash,
    now: () => clock,
    rateLimits: {
      pairing: { windowMs: 60_000, limit: 1_000 },
      upload: { windowMs: 60_000, limit: 1_000 },
      publicRead: { windowMs: 60_000, limit: 1_000 },
      ownerLogin: { windowMs: 60_000, limit: 1_000 },
      ownerApi: { windowMs: 60_000, limit: 1_000 },
    },
    ...options,
  });
  return {
    ...service,
    dataDir,
    api: request(service.app),
    advance(milliseconds) {
      clock += milliseconds;
    },
    async destroy(remove = true) {
      service.close();
      if (remove) await fsp.rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function login(instance, key = accessKey) {
  const response = await instance.api
    .post('/api/owner/session')
    .set('Origin', origin)
    .set('Content-Type', 'application/json')
    .send({ accessKey: key })
    .expect(204);
  const setCookie = response.headers['set-cookie'];
  assert.ok(Array.isArray(setCookie));
  assert.match(setCookie[0], /^__Host-imnota_owner=[A-Za-z0-9_-]{43};/);
  assert.match(setCookie[0], /Path=\//);
  assert.match(setCookie[0], /Secure/);
  assert.match(setCookie[0], /HttpOnly/);
  assert.match(setCookie[0], /SameSite=Strict/);
  return setCookie[0].split(';', 1)[0];
}

async function ownerSession(instance, cookie) {
  return instance.api.get('/api/owner/session').set('Cookie', cookie).expect(200);
}

async function createShare(instance, title = 'Private dashboard row') {
  const paired = await instance.api.post('/api/pairing').set('Origin', origin).send({}).expect(201);
  return instance.api
    .post('/api/shares')
    .set('Authorization', `Bearer ${paired.body.uploadToken}`)
    .send({
      requestId: randomUUID(),
      title,
      markdown: '# Prompt',
      bundles: [{ bundleNumber: 1, markdown: '# Prompt\n\nDetails', imageFilename: 'prompt-001.png' }],
      images: [{ filename: 'prompt-001.png', dataBase64: png.toString('base64') }],
      includeArchive: true,
      expiresInDays: 1,
    })
    .expect(201);
}

test('owner routes fail closed when the access-key hash is not configured', async (t) => {
  const instance = await fixture({ ownerAccessKeyHash: null });
  t.after(() => instance.destroy());
  await instance.api
    .get('/owner')
    .expect(404)
    .expect('Cache-Control', /no-store/);
  await instance.api
    .get('/api/owner/session')
    .expect(404)
    .expect(({ body }) => {
      assert.equal(body.error.code, 'not_found');
    });
  await instance.api.get('/health').expect(200);
});

test('owner sign-in uses a strict host cookie and rejects bad origins, types, and credentials', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  await instance.api.post('/api/owner/session').send({ accessKey }).expect(403);
  await instance.api
    .post('/api/owner/session')
    .set('Origin', 'https://evil.example')
    .send({ accessKey })
    .expect(403);
  await instance.api
    .post('/api/owner/session')
    .set('Origin', origin)
    .set('Content-Type', 'text/plain')
    .send(JSON.stringify({ accessKey }))
    .expect(415);
  await instance.api
    .post('/api/owner/session')
    .set('Origin', origin)
    .send({ accessKey: randomBytes(32).toString('base64url') })
    .expect(401)
    .expect(({ body }) => assert.equal(body.error.code, 'invalid_credentials'));
  const cookie = await login(instance);
  const session = await ownerSession(instance, cookie);
  assert.match(session.body.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(session.body.authenticated, true);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS count FROM owner_sessions').get().count, 1);
  assert.equal(
    JSON.stringify(instance.db.prepare('SELECT * FROM owner_sessions').get()).includes(accessKey),
    false,
  );
});

test('owner sessions enforce idle and absolute expiry and key rotation invalidates old sessions', async (t) => {
  const instance = await fixture({ ownerSessionIdleMs: 1_000, ownerSessionAbsoluteMs: 10_000 });
  const cookie = await login(instance);
  instance.advance(1_001);
  await instance.api.get('/api/owner/session').set('Cookie', cookie).expect(401);
  const secondCookie = await login(instance);
  const dataDir = instance.dataDir;
  await instance.destroy(false);
  const rotatedKey = randomBytes(32).toString('base64url');
  const reopened = await fixture({
    dataDir,
    ownerAccessKeyHash: createHash('sha256').update(rotatedKey).digest('hex'),
  });
  t.after(() => reopened.destroy());
  await reopened.api.get('/api/owner/session').set('Cookie', secondCookie).expect(401);
  assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM owner_sessions').get().count, 0);
});

test('owner list exposes only bounded metadata and honest aggregate request counts', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  const created = await createShare(instance);
  const publicToken = created.body.url.split('/').at(-1);
  await instance.api.head(`/s/${publicToken}`).expect(200);
  await instance.api.get(`/s/${publicToken}`).expect(200);
  await instance.api.get(`/s/${publicToken}/markdown`).expect(200);
  await instance.api.get(`/s/${publicToken}/bundles/1/markdown`).expect(200);
  await instance.api.get(`/s/${publicToken}/assets/prompt-001.png`).expect(200);
  await instance.api.get(`/s/${publicToken}/archive.zip`).expect(200);
  const cookie = await login(instance);
  const listing = await instance.api
    .get('/api/owner/shares?status=active&limit=1')
    .set('Cookie', cookie)
    .expect(200)
    .expect('Cache-Control', /no-store/);
  assert.equal(listing.body.shares.length, 1);
  assert.deepEqual(listing.body.shares[0].usage, {
    pageViews: 1,
    markdownRequests: 2,
    pngRequests: 1,
    zipRequests: 1,
    lastAccessedAt: new Date(Date.UTC(2026, 8, 8, 12)).toISOString(),
  });
  assert.equal(listing.body.totals.usage.pageViews, 1);
  assert.equal(listing.body.totals.metadataBytes, Buffer.byteLength('# Prompt\n\nDetails'));
  assert.equal(
    listing.body.totals.storedBytes,
    created.body.byteSize + Buffer.byteLength('# Prompt\n\nDetails'),
  );
  assert.equal(listing.body.shares[0].storedBytes, listing.body.totals.storedBytes);
  const serialized = JSON.stringify(listing.body);
  assert.equal(serialized.includes(publicToken), false);
  assert.equal(serialized.includes(created.body.managementToken), false);
  for (const privateName of [
    'public_token_hash',
    'management_token_hash',
    'upload_token_hash',
    'payload_hash',
    'request_id',
    'uploadsDir',
  ])
    assert.equal(serialized.includes(privateName), false);
});

test('owner revocation requires the session, exact origin, and derived CSRF token', async (t) => {
  const instance = await fixture();
  t.after(() => instance.destroy());
  const created = await createShare(instance);
  const endpoint = `/api/owner/shares/${created.body.id}/revoke`;
  const cookie = await login(instance);
  const session = await ownerSession(instance, cookie);
  await instance.api.post(endpoint).expect(401);
  await instance.api.post(endpoint).set('Cookie', cookie).set('Origin', origin).expect(403);
  await instance.api
    .post(endpoint)
    .set('Cookie', cookie)
    .set('Origin', 'https://evil.example')
    .set('X-CSRF-Token', session.body.csrfToken)
    .expect(403);
  const revoked = await instance.api
    .post(endpoint)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .set('X-CSRF-Token', session.body.csrfToken)
    .expect(200);
  assert.match(revoked.body.revokedAt, /Z$/);
  await instance.api.get(created.body.url.replace(origin, '')).expect(404);
});

test('persistent owner throttle is bounded and owner page contains login and dashboard states', async (t) => {
  const instance = await fixture({ ownerLoginThrottleLimit: 2, ownerLoginThrottleWindowMs: 1_000 });
  t.after(() => instance.destroy());
  const page = await instance.api.get('/owner').expect(200);
  assert.match(page.text, /data-login/);
  assert.match(page.text, /data-dashboard/);
  assert.match(page.text, /do not identify people/);
  const wrong = randomBytes(32).toString('base64url');
  for (let attempt = 0; attempt < 2; attempt += 1)
    await instance.api
      .post('/api/owner/session')
      .set('Origin', origin)
      .send({ accessKey: wrong })
      .expect(401);
  await instance.api
    .post('/api/owner/session')
    .set('Origin', origin)
    .send({ accessKey })
    .expect(429)
    .expect('Retry-After', '1');
  instance.advance(1_001);
  await login(instance);
});
