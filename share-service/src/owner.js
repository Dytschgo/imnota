import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { rateLimit } from 'express-rate-limit';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(sourceDir, '../public');
const sessionCookie = '__Host-imnota_owner';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ownerMetaCsp =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'self'";

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function randomToken() {
  return randomBytes(32).toString('base64url');
}

function csrfToken(sessionToken, receiptSecret) {
  return createHmac('sha256', Buffer.from(receiptSecret, 'base64url'))
    .update('imnota-owner-csrf-v1:', 'utf8')
    .update(sessionToken, 'utf8')
    .digest('base64url');
}

function parseSessionCookie(request) {
  const header = request.get('cookie');
  if (!header) return undefined;
  const values = [];
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== sessionCookie) continue;
    values.push(part.slice(separator + 1).trim());
  }
  return values.length === 1 && tokenPattern.test(values[0]) ? values[0] : undefined;
}

function setSessionCookie(response, token, maxAgeMs) {
  response.append(
    'Set-Cookie',
    `${sessionCookie}=${token}; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; Secure; HttpOnly; SameSite=Strict`,
  );
}

function clearSessionCookie(response) {
  response.append('Set-Cookie', `${sessionCookie}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`);
}

function error(response, status, code, message) {
  return response.status(status).json({ error: { code, message } });
}

function requireOrigin(request, response, config) {
  if (request.get('origin') !== config.publicOrigin) {
    error(response, 403, 'origin_denied', 'The request origin is not allowed.');
    return false;
  }
  return true;
}

function sessionFor(request, response, { db, config, now }) {
  const token = parseSessionCookie(request);
  if (!token) {
    error(response, 401, 'authentication_required', 'Owner authentication is required.');
    return undefined;
  }
  const tokenHash = sha256(token);
  const timestamp = now();
  const record = db.prepare('SELECT * FROM owner_sessions WHERE token_hash = ?').get(tokenHash);
  if (
    !record ||
    record.auth_fingerprint !== config.ownerAccessKeyHash ||
    record.expires_at <= timestamp ||
    record.last_seen_at + config.ownerSessionIdleMs <= timestamp
  ) {
    if (record) db.prepare('DELETE FROM owner_sessions WHERE token_hash = ?').run(tokenHash);
    clearSessionCookie(response);
    error(response, 401, 'authentication_required', 'Owner authentication is required.');
    return undefined;
  }
  if (record.last_seen_at + 60_000 <= timestamp)
    db.prepare('UPDATE owner_sessions SET last_seen_at = ? WHERE token_hash = ?').run(timestamp, tokenHash);
  return { token, tokenHash, record };
}

function requireCsrf(request, response, session, config) {
  if (!requireOrigin(request, response, config)) return false;
  const supplied = request.get('x-csrf-token');
  const expected = csrfToken(session.token, config.receiptSecret);
  if (!safeEqual(supplied, expected)) {
    error(response, 403, 'csrf_denied', 'The request could not be verified.');
    return false;
  }
  return true;
}

function throttleState(db, config, timestamp) {
  const row = db.prepare('SELECT * FROM owner_login_throttle WHERE id = 1').get();
  if (row?.blocked_until > timestamp) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((row.blocked_until - timestamp) / 1000),
    };
  }
  if (!row || row.window_started_at + config.ownerLoginThrottleWindowMs <= timestamp) {
    if (row)
      db.prepare(
        'UPDATE owner_login_throttle SET window_started_at = ?, failures = 0, blocked_until = 0 WHERE id = 1',
      ).run(timestamp);
    return { blocked: false, retryAfterSeconds: 0 };
  }
  return {
    blocked: row.blocked_until > timestamp,
    retryAfterSeconds: Math.max(1, Math.ceil((row.blocked_until - timestamp) / 1000)),
  };
}

function recordLoginFailure(db, config, timestamp) {
  const row = db.prepare('SELECT * FROM owner_login_throttle WHERE id = 1').get();
  if (!row || row.window_started_at + config.ownerLoginThrottleWindowMs <= timestamp) {
    db.prepare(
      'INSERT INTO owner_login_throttle (id, window_started_at, failures, blocked_until) VALUES (1, ?, 1, 0) ON CONFLICT(id) DO UPDATE SET window_started_at = excluded.window_started_at, failures = 1, blocked_until = 0',
    ).run(timestamp);
    return;
  }
  const failures = row.failures + 1;
  const blockedUntil =
    failures >= config.ownerLoginThrottleLimit
      ? Math.max(row.blocked_until, timestamp + config.ownerLoginThrottleWindowMs)
      : row.blocked_until;
  db.prepare('UPDATE owner_login_throttle SET failures = ?, blocked_until = ? WHERE id = 1').run(
    failures,
    blockedUntil,
  );
}

function resetLoginThrottle(db) {
  db.prepare('DELETE FROM owner_login_throttle WHERE id = 1').run();
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 200 || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Number.isSafeInteger(parsed.createdAt) ||
      parsed.createdAt < 0 ||
      typeof parsed.id !== 'string' ||
      !uuidPattern.test(parsed.id)
    )
      return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function statusClause(status) {
  if (status === 'active') return 's.revoked_at IS NULL AND s.expires_at > ?';
  if (status === 'expired') return 's.revoked_at IS NULL AND s.expires_at <= ?';
  if (status === 'revoked') return 's.revoked_at IS NOT NULL';
  return '1 = 1';
}

function serializeShare(row, timestamp) {
  const status = row.revoked_at !== null ? 'revoked' : row.expires_at <= timestamp ? 'expired' : 'active';
  return {
    id: row.id,
    title: row.title,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
    byteSize: row.byte_size,
    metadataBytes: row.metadata_byte_size,
    storedBytes: row.byte_size + row.metadata_byte_size,
    hasArchive: row.has_archive === 1,
    status,
    usage: {
      pageViews: row.page_views,
      markdownRequests: row.markdown_requests,
      pngRequests: row.asset_requests,
      zipRequests: row.archive_requests,
      lastAccessedAt: row.last_accessed_at === null ? null : new Date(row.last_accessed_at).toISOString(),
    },
  };
}

function ownerPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ownerMetaCsp}"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Owner · Imnota</title><link rel="stylesheet" href="/static/owner.css"><script type="module" src="/static/owner.js"></script></head><body><main class="owner-shell"><header><p class="eyebrow">Imnota private service</p><h1>Shared links</h1><p class="lede">Request totals from this service. They do not identify people.</p></header><section class="panel" data-login hidden><h2>Owner access</h2><form data-login-form><label for="access-key">Access key</label><input id="access-key" name="accessKey" type="password" autocomplete="current-password" required><button type="submit">Sign in</button></form><p class="message" role="alert" data-login-error></p></section><section data-dashboard hidden><div class="toolbar"><label for="status-filter">Show</label><select id="status-filter" data-status-filter><option value="all">All links</option><option value="active">Active</option><option value="expired">Expired</option><option value="revoked">Revoked</option></select><button class="quiet" type="button" data-refresh>Refresh</button><button class="quiet" type="button" data-logout>Sign out</button></div><div class="totals" data-totals aria-live="polite"></div><p class="message" role="alert" data-dashboard-error></p><div class="share-list" data-share-list></div><button class="load-more" type="button" data-load-more hidden>Load more</button></section></main></body></html>`;
}

export function installOwnerRoutes({ app, db, config, now = () => Date.now() }) {
  const disabled = !config.ownerAccessKeyHash;
  const json = express.json({ limit: '1kb', strict: true });
  const loginLimiter = rateLimit({
    ...config.rateLimits.ownerLogin,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, response) =>
      error(response, 429, 'rate_limited', 'Too many sign-in attempts. Try again later.'),
  });
  const ownerApiLimiter = rateLimit({
    ...config.rateLimits.ownerApi,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, response) =>
      error(response, 429, 'rate_limited', 'Too many owner requests. Try again later.'),
  });

  app.use(['/owner', '/api/owner'], (_request, response, next) => {
    response.set({
      'Cache-Control': 'private, no-store, no-transform',
      Pragma: 'no-cache',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    next();
  });
  app.use('/api/owner', ownerApiLimiter);

  app.get('/owner', (_request, response) => {
    if (disabled) return response.status(404).type('text').send('Not found.');
    return response.type('html').send(ownerPage());
  });

  app.post('/api/owner/session', loginLimiter, (request, response, next) => {
    if (disabled) return error(response, 404, 'not_found', 'Endpoint not found.');
    if (!requireOrigin(request, response, config)) return undefined;
    if (!request.is('application/json'))
      return error(response, 415, 'unsupported_media_type', 'A JSON request is required.');
    const timestamp = now();
    const throttle = throttleState(db, config, timestamp);
    if (throttle.blocked) {
      response.set('Retry-After', String(throttle.retryAfterSeconds));
      return error(response, 429, 'rate_limited', 'Too many sign-in attempts. Try again later.');
    }
    return json(request, response, (parseError) => {
      if (parseError) return next(parseError);
      const candidate = typeof request.body?.accessKey === 'string' ? request.body.accessKey : '';
      const matches = safeEqual(sha256(candidate), config.ownerAccessKeyHash);
      if (!matches || !tokenPattern.test(candidate)) {
        recordLoginFailure(db, config, timestamp);
        return error(response, 401, 'invalid_credentials', 'The owner access key is invalid.');
      }
      resetLoginThrottle(db);
      const existing = parseSessionCookie(request);
      if (existing) db.prepare('DELETE FROM owner_sessions WHERE token_hash = ?').run(sha256(existing));
      db.prepare('DELETE FROM owner_sessions WHERE expires_at <= ? OR last_seen_at + ? <= ?').run(
        timestamp,
        config.ownerSessionIdleMs,
        timestamp,
      );
      const sessionToken = randomToken();
      db.prepare(
        'INSERT INTO owner_sessions (token_hash, created_at, last_seen_at, expires_at, auth_fingerprint) VALUES (?, ?, ?, ?, ?)',
      ).run(
        sha256(sessionToken),
        timestamp,
        timestamp,
        timestamp + config.ownerSessionAbsoluteMs,
        config.ownerAccessKeyHash,
      );
      const excess = db
        .prepare('SELECT token_hash FROM owner_sessions ORDER BY created_at DESC LIMIT -1 OFFSET 10')
        .all();
      const remove = db.prepare('DELETE FROM owner_sessions WHERE token_hash = ?');
      for (const row of excess) remove.run(row.token_hash);
      setSessionCookie(response, sessionToken, config.ownerSessionAbsoluteMs);
      return response.status(204).end();
    });
  });

  app.get('/api/owner/session', (request, response) => {
    if (disabled) return error(response, 404, 'not_found', 'Endpoint not found.');
    const session = sessionFor(request, response, { db, config, now });
    if (!session) return undefined;
    return response.json({
      authenticated: true,
      csrfToken: csrfToken(session.token, config.receiptSecret),
      expiresAt: new Date(session.record.expires_at).toISOString(),
    });
  });

  app.delete('/api/owner/session', (request, response) => {
    if (disabled) return error(response, 404, 'not_found', 'Endpoint not found.');
    const session = sessionFor(request, response, { db, config, now });
    if (!session || !requireCsrf(request, response, session, config)) return undefined;
    db.prepare('DELETE FROM owner_sessions WHERE token_hash = ?').run(session.tokenHash);
    clearSessionCookie(response);
    return response.status(204).end();
  });

  app.get('/api/owner/shares', (request, response) => {
    if (disabled) return error(response, 404, 'not_found', 'Endpoint not found.');
    if (!sessionFor(request, response, { db, config, now })) return undefined;
    const status = typeof request.query.status === 'string' ? request.query.status : 'all';
    if (!['all', 'active', 'expired', 'revoked'].includes(status))
      return error(response, 400, 'invalid_request', 'The status filter is invalid.');
    const limitText = typeof request.query.limit === 'string' ? request.query.limit : '50';
    if (!/^\d{1,3}$/u.test(limitText))
      return error(response, 400, 'invalid_request', 'The page size is invalid.');
    const limit = Number(limitText);
    if (limit < 1 || limit > 100)
      return error(response, 400, 'invalid_request', 'The page size must be between 1 and 100.');
    const cursor = decodeCursor(request.query.cursor);
    if (cursor === null) return error(response, 400, 'invalid_request', 'The page cursor is invalid.');
    const timestamp = now();
    const where = [statusClause(status)];
    const parameters = [];
    if (status === 'active' || status === 'expired') parameters.push(timestamp);
    if (cursor) {
      where.push('(s.created_at < ? OR (s.created_at = ? AND s.id < ?))');
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    parameters.push(limit + 1);
    const rows = db
      .prepare(
        `SELECT s.id, s.title, s.created_at, s.expires_at, s.revoked_at, s.byte_size, s.metadata_byte_size, s.has_archive,
          COALESCE(u.page_views, 0) AS page_views,
          COALESCE(u.markdown_requests, 0) AS markdown_requests,
          COALESCE(u.asset_requests, 0) AS asset_requests,
          COALESCE(u.archive_requests, 0) AS archive_requests,
          u.last_accessed_at
        FROM shares s LEFT JOIN share_usage u ON u.share_id = s.id
        WHERE ${where.join(' AND ')}
        ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
      )
      .all(...parameters);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS shares,
          COALESCE(SUM(CASE WHEN s.revoked_at IS NULL AND s.expires_at > ? THEN 1 ELSE 0 END), 0) AS active,
          COALESCE(SUM(CASE WHEN s.revoked_at IS NULL AND s.expires_at <= ? THEN 1 ELSE 0 END), 0) AS expired,
          COALESCE(SUM(CASE WHEN s.revoked_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS revoked,
          COALESCE(SUM(s.byte_size), 0) AS byte_size,
          COALESCE(SUM(s.metadata_byte_size), 0) AS metadata_byte_size,
          COALESCE(SUM(u.page_views), 0) AS page_views,
          COALESCE(SUM(u.markdown_requests), 0) AS markdown_requests,
          COALESCE(SUM(u.asset_requests), 0) AS asset_requests,
          COALESCE(SUM(u.archive_requests), 0) AS archive_requests
        FROM shares s LEFT JOIN share_usage u ON u.share_id = s.id`,
      )
      .get(timestamp, timestamp);
    return response.json({
      shares: page.map((row) => serializeShare(row, timestamp)),
      totals: {
        shares: totals.shares,
        active: totals.active,
        expired: totals.expired,
        revoked: totals.revoked,
        byteSize: totals.byte_size,
        metadataBytes: totals.metadata_byte_size,
        storedBytes: totals.byte_size + totals.metadata_byte_size,
        usage: {
          pageViews: totals.page_views,
          markdownRequests: totals.markdown_requests,
          pngRequests: totals.asset_requests,
          zipRequests: totals.archive_requests,
        },
      },
      nextCursor: hasMore ? encodeCursor(page.at(-1)) : null,
    });
  });

  app.post('/api/owner/shares/:id/revoke', (request, response) => {
    if (disabled) return error(response, 404, 'not_found', 'Endpoint not found.');
    const session = sessionFor(request, response, { db, config, now });
    if (!session || !requireCsrf(request, response, session, config)) return undefined;
    const id = request.params.id.toLowerCase();
    if (!uuidPattern.test(id)) return error(response, 404, 'not_found', 'Share not found.');
    const record = db.prepare('SELECT id, revoked_at FROM shares WHERE id = ?').get(id);
    if (!record) return error(response, 404, 'not_found', 'Share not found.');
    const revokedAt = record.revoked_at ?? now();
    if (record.revoked_at === null)
      db.prepare('UPDATE shares SET revoked_at = ? WHERE id = ?').run(revokedAt, id);
    return response.json({ id, revokedAt: new Date(revokedAt).toISOString() });
  });

  app.use('/api/owner', (_request, response) => error(response, 404, 'not_found', 'Endpoint not found.'));
}

export function recordUsage({ db, now = () => Date.now() }) {
  const incrementSql = new Map(
    ['page_views', 'markdown_requests', 'asset_requests', 'archive_requests'].map((column) => [
      column,
      db.prepare(
        `INSERT INTO share_usage (share_id, ${column}, last_accessed_at) VALUES (?, 1, ?)
         ON CONFLICT(share_id) DO UPDATE SET ${column} = ${column} + 1, last_accessed_at = excluded.last_accessed_at`,
      ),
    ]),
  );
  return (request, response, next) => {
    if (request.method !== 'GET') return next();
    const parts = request.path.split('/').filter(Boolean);
    const token = parts[0];
    if (!tokenPattern.test(token ?? '')) return next();
    let column;
    if (parts.length === 1) column = 'page_views';
    else if (parts.length === 2 && parts[1] === 'markdown') column = 'markdown_requests';
    else if (
      parts.length === 4 &&
      parts[1] === 'bundles' &&
      /^[1-9][0-9]{0,2}$/u.test(parts[2]) &&
      parts[3] === 'markdown'
    )
      column = 'markdown_requests';
    else if (parts.length === 3 && parts[1] === 'assets') column = 'asset_requests';
    else if (parts.length === 2 && parts[1] === 'archive.zip') column = 'archive_requests';
    if (!column) return next();
    const record = db
      .prepare('SELECT id FROM shares WHERE public_token_hash = ? AND revoked_at IS NULL AND expires_at > ?')
      .get(sha256(token), now());
    if (!record) return next();
    response.once('finish', () => {
      if (response.statusCode < 200 || response.statusCode >= 300) return;
      try {
        incrementSql.get(column).run(record.id, now());
      } catch {
        console.error('Share usage counter update failed.');
      }
    });
    return next();
  };
}

export const ownerStaticDir = staticDir;
