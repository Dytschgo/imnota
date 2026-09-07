import archiver from 'archiver';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { loadConfig } from './config.js';
import { openDatabase } from './database.js';
import { directorySize } from './maintenance.js';
import {
  deriveToken,
  escapeHtml,
  isSafePngFilename,
  normalizePng,
  preflightPng,
  randomToken,
  safeHashEqual,
  tokenHash,
} from './security.js';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(sourceDir, '../public');
const metaCsp =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'self'";
const metaCspTag = `<meta http-equiv="Content-Security-Policy" content="${metaCsp}">`;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const asyncRoute = (handler) => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

function concurrencyGate(limit) {
  let active = 0;
  return (request, response, next) => {
    if (active >= limit) {
      return response.status(503).json({
        error: { code: 'server_busy', message: 'Too many uploads are in progress. Try again later.' },
      });
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    response.once('finish', release);
    response.once('close', release);
    next();
  };
}

async function waitForCommittedShare(db, uploadTokenHash, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = db.prepare('SELECT * FROM shares WHERE upload_token_hash = ?').get(uploadTokenHash);
    if (record) return record;
    const staging = db
      .prepare('SELECT 1 FROM staging_uploads WHERE upload_token_hash = ?')
      .get(uploadTokenHash);
    if (!staging) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

function jsonLimiter(settings) {
  return rateLimit({
    ...settings,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, response) =>
      response.status(429).json({
        error: { code: 'rate_limited', message: 'Too many requests. Try again later.' },
      }),
  });
}

function validateUpload(body, config) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'invalid_request', 'A JSON upload object is required.');
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (
    !title ||
    title.length > 200 ||
    [...title].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) {
    throw new ApiError(400, 'invalid_request', 'Title must contain 1 to 200 printable characters.');
  }
  if (typeof body.markdown !== 'string') {
    throw new ApiError(400, 'invalid_request', 'Markdown must be a string.');
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId.toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(requestId)) {
    throw new ApiError(400, 'invalid_request', 'requestId must be a UUID generated for this upload.');
  }
  const markdown = Buffer.from(body.markdown, 'utf8');
  if (markdown.length > config.maxMarkdownBytes) {
    throw new ApiError(413, 'payload_too_large', 'Markdown exceeds the size limit.');
  }
  if (!Array.isArray(body.images) || body.images.length > config.maxImages) {
    throw new ApiError(
      400,
      'invalid_request',
      `Images must be an array with at most ${config.maxImages} entries.`,
    );
  }
  const filenames = new Set();
  let uploadedBytes = markdown.length;
  let totalImagePixels = 0;
  let totalInflatedPngBytes = 0;
  const pngLimits = {
    maxDimension: config.maxImageDimension,
    maxPixels: config.maxImagePixels,
    maxInflatedBytes: config.maxInflatedPngBytes,
  };
  const imageCandidates = body.images.map((image) => {
    if (!image || typeof image !== 'object' || !isSafePngFilename(image.filename)) {
      throw new ApiError(400, 'invalid_request', 'Each image needs a safe .png filename without a path.');
    }
    const foldedName = image.filename.toLowerCase();
    if (filenames.has(foldedName)) {
      throw new ApiError(400, 'invalid_request', 'Image filenames must be unique.');
    }
    filenames.add(foldedName);
    if (
      typeof image.dataBase64 !== 'string' ||
      image.dataBase64.length > Math.ceil(config.maxImageBytes / 3) * 4 + 4 ||
      image.dataBase64.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(image.dataBase64)
    ) {
      throw new ApiError(400, 'invalid_request', `Image ${image.filename} has invalid base64 data.`);
    }
    const uploadedData = Buffer.from(image.dataBase64, 'base64');
    if (uploadedData.length > config.maxImageBytes) {
      throw new ApiError(413, 'payload_too_large', `Image ${image.filename} exceeds the size limit.`);
    }
    uploadedBytes += uploadedData.length;
    if (uploadedBytes > config.maxBundleBytes) {
      throw new ApiError(413, 'payload_too_large', 'The decoded upload bundle exceeds the size limit.');
    }
    let inspected;
    try {
      inspected = preflightPng(uploadedData, pngLimits);
    } catch (error) {
      throw new ApiError(400, 'invalid_request', `${image.filename}: ${error.message}`);
    }
    totalImagePixels += inspected.pixels;
    totalInflatedPngBytes += inspected.inflatedBytes;
    return { filename: image.filename, uploadedData, inspected };
  });
  if (totalImagePixels > config.maxBundleImagePixels) {
    throw new ApiError(
      413,
      'payload_too_large',
      `The bundle exceeds the ${config.maxBundleImagePixels} pixel image limit.`,
    );
  }
  if (totalInflatedPngBytes > config.maxBundleInflatedPngBytes) {
    throw new ApiError(413, 'payload_too_large', 'The bundle exceeds the inflated PNG memory limit.');
  }
  const images = imageCandidates.map(({ filename, uploadedData, inspected }) => {
    let normalized;
    try {
      normalized = normalizePng(uploadedData, pngLimits, inspected);
    } catch (error) {
      throw new ApiError(400, 'invalid_request', `${filename}: ${error.message}`);
    }
    if (normalized.data.length > config.maxImageBytes) {
      throw new ApiError(413, 'payload_too_large', `Normalized image ${filename} exceeds the size limit.`);
    }
    return { filename, ...normalized };
  });
  const decodedBytes = markdown.length + images.reduce((sum, image) => sum + image.data.length, 0);
  if (decodedBytes > config.maxBundleBytes) {
    throw new ApiError(413, 'payload_too_large', 'The normalized bundle exceeds the size limit.');
  }
  const expiresInDays = body.expiresInDays ?? config.defaultExpiryDays;
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > config.maxExpiryDays) {
    throw new ApiError(
      400,
      'invalid_request',
      `expiresInDays must be between 1 and ${config.maxExpiryDays}.`,
    );
  }
  if (body.includeArchive !== undefined && typeof body.includeArchive !== 'boolean') {
    throw new ApiError(400, 'invalid_request', 'includeArchive must be a boolean.');
  }
  return {
    requestId,
    title,
    markdown,
    images,
    decodedBytes,
    expiresInDays,
    includeArchive: body.includeArchive === true,
  };
}

function uploadFingerprint(upload) {
  const hash = createHash('sha256');
  const append = (value) => {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    hash.update(String(data.length)).update(':').update(data).update(';');
  };
  append('imnota-share-upload-v1');
  append(upload.requestId);
  append(upload.title);
  append(upload.markdown);
  append(upload.includeArchive ? '1' : '0');
  append(upload.expiresInDays);
  const sortedImages = [...upload.images].sort((left, right) =>
    left.filename.localeCompare(right.filename, 'en'),
  );
  for (const image of sortedImages) {
    append(image.filename);
    append(image.data);
  }
  return hash.digest('hex');
}

function shareReceipt(record, uploadToken, config, assets, recovered = false) {
  const publicToken = deriveToken(config.receiptSecret, uploadToken, record.request_id, 'public');
  const managementToken = deriveToken(config.receiptSecret, uploadToken, record.request_id, 'management');
  const url = `${config.publicOrigin}/s/${publicToken}`;
  return {
    id: record.id,
    url,
    title: record.title,
    createdAt: new Date(record.created_at).toISOString(),
    expiresAt: new Date(record.expires_at).toISOString(),
    byteSize: record.byte_size,
    managementToken,
    recovered,
    artifacts: {
      markdownUrl: `${url}/markdown`,
      imageUrls: assets.map((image) => `${url}/assets/${encodeURIComponent(image.filename)}`),
      archiveUrl: record.has_archive ? `${url}/archive.zip` : null,
    },
  };
}

async function writeArchive(directory, images) {
  const archivePath = path.join(directory, 'archive.zip');
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(archivePath, { mode: 0o600 });
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.once('close', resolve);
    output.once('error', reject);
    archive.once('warning', reject);
    archive.once('error', reject);
    archive.pipe(output);
    archive.file(path.join(directory, 'prompt.md'), { name: 'prompt.md' });
    for (const image of images) {
      archive.file(path.join(directory, image.filename), { name: image.filename });
    }
    archive.finalize().catch(reject);
  });
  return (await fsp.stat(archivePath)).size;
}

function markdownRenderer() {
  const renderer = new MarkdownIt({ html: false, linkify: true, typographer: false });
  const originalLinkOpen =
    renderer.renderer.rules.link_open ??
    ((tokens, index, options, _environment, self) => self.renderToken(tokens, index, options));
  renderer.renderer.rules.link_open = (tokens, index, options, environment, self) => {
    tokens[index].attrSet('rel', 'nofollow noreferrer noopener');
    tokens[index].attrSet('target', '_blank');
    return originalLinkOpen(tokens, index, options, environment, self);
  };
  return (markdown) =>
    sanitizeHtml(renderer.render(markdown), {
      allowedTags: [
        'p',
        'br',
        'hr',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'blockquote',
        'pre',
        'code',
        'ul',
        'ol',
        'li',
        'strong',
        'em',
        's',
        'a',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
      ],
      allowedAttributes: { a: ['href', 'rel', 'target'] },
      allowedSchemes: ['http', 'https', 'mailto'],
      allowProtocolRelative: false,
    });
}

function unavailablePage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${metaCspTag}<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Share unavailable · Imnota</title><link rel="stylesheet" href="/static/share.css"></head><body><main><p class="eyebrow">Imnota shared prompt</p><h1>Share unavailable</h1><p>This link does not exist, has expired, or was revoked.</p></main></body></html>`;
}

function sharePage(record, markdownHtml, assets, publicToken, publicOrigin) {
  const imageHtml =
    assets.length === 0
      ? ''
      : `<section><h2>Images</h2><div class="images">${assets
          .map((asset) => {
            const encoded = encodeURIComponent(asset.filename);
            return `<figure><a href="/s/${publicToken}/assets/${encoded}" download><img src="/s/${publicToken}/assets/${encoded}" alt="${escapeHtml(asset.filename)}" loading="lazy"></a><figcaption>${escapeHtml(asset.filename)} · ${asset.width} × ${asset.height}</figcaption></figure>`;
          })
          .join('')}</div></section>`;
  const archive = record.has_archive
    ? `<a class="button" href="/s/${publicToken}/archive.zip">Download ZIP</a>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${metaCspTag}<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(record.title)} · Imnota</title><link rel="stylesheet" href="/static/share.css"></head><body><main><p class="eyebrow">Intentionally published with Imnota</p><h1>${escapeHtml(record.title)}</h1><p class="expiry">Available until <time datetime="${new Date(record.expires_at).toISOString()}">${new Date(record.expires_at).toLocaleString('en-GB', { timeZone: 'UTC', timeZoneName: 'short' })}</time></p><nav><a class="button" href="/s/${publicToken}/markdown">Download Markdown</a>${archive}</nav><article>${markdownHtml}</article>${imageHtml}<footer>Read-only share hosted at ${escapeHtml(new URL(publicOrigin).host)}.</footer></main></body></html>`;
}

export function createService(overrides = {}) {
  const config = loadConfig(overrides);
  const db = openDatabase(config);
  const renderMarkdown = markdownRenderer();
  const now = overrides.now ?? (() => Date.now());
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
        },
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use('/static', express.static(staticDir, { fallthrough: false, etag: true, maxAge: '1h' }));
  const pairingLimiter = jsonLimiter(config.rateLimits.pairing);
  const uploadLimiter = jsonLimiter(config.rateLimits.upload);
  const publicLimiter = jsonLimiter(config.rateLimits.publicRead);
  const uploadConcurrency = concurrencyGate(config.maxConcurrentUploads);
  const pairingJsonParser = express.json({ limit: '1kb', strict: true });
  const uploadJsonParser = express.json({ limit: config.jsonLimit, strict: true });

  app.get(
    '/health',
    publicLimiter,
    asyncRoute(async (_request, response) => {
      db.prepare('SELECT 1').get();
      const recorded = db.prepare('SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM shares').get().bytes;
      const reserved = db
        .prepare('SELECT COALESCE(SUM(reserved_bytes), 0) AS bytes FROM staging_uploads')
        .get().bytes;
      const storageBytes = await directorySize(config.uploadsDir);
      response.json({ status: 'ok', storageBytes, recordedBytes: recorded, reservedBytes: reserved });
    }),
  );

  app.get('/new', publicLimiter, (_request, response) => {
    response.set('X-Robots-Tag', 'noindex, nofollow');
    response.sendFile(path.join(staticDir, 'new.html'));
  });

  app.post('/api/pairing', pairingLimiter, pairingJsonParser, (request, response, next) => {
    try {
      if (!config.allowedPairingOrigins.includes(request.get('origin'))) {
        throw new ApiError(403, 'origin_denied', 'Pairing must be started from the Imnota sharing page.');
      }
      const uploadToken = randomToken();
      const pairingId = randomUUID();
      const createdAt = now();
      const expiresAt = createdAt + config.pairingTtlMs;
      db.prepare('INSERT INTO pairings (id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
        pairingId,
        tokenHash(uploadToken),
        createdAt,
        expiresAt,
      );
      response.status(201).json({ pairingId, uploadToken, expiresAt: new Date(expiresAt).toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/api/shares',
    uploadLimiter,
    uploadConcurrency,
    uploadJsonParser,
    asyncRoute(async (request, response) => {
      const bearer = readBearer(request);
      if (!bearer) throw new ApiError(401, 'invalid_token', 'The upload token is invalid.');
      const uploadTokenHash = tokenHash(bearer);
      const pairing = db.prepare('SELECT * FROM pairings WHERE token_hash = ?').get(uploadTokenHash);
      const existing = db.prepare('SELECT * FROM shares WHERE upload_token_hash = ?').get(uploadTokenHash);
      if (!pairing && !existing) throw new ApiError(401, 'invalid_token', 'The upload token is invalid.');
      const upload = validateUpload(request.body, config);
      const payloadHash = uploadFingerprint(upload);
      if (existing) {
        if (existing.request_id !== upload.requestId || !safeHashEqual(existing.payload_hash, payloadHash)) {
          throw new ApiError(
            409,
            'idempotency_conflict',
            'This upload token is already bound to a different request.',
          );
        }
        if (existing.recovery_until <= now()) {
          throw new ApiError(410, 'recovery_expired', 'The upload receipt recovery window expired.');
        }
        const existingAssets = db
          .prepare('SELECT filename FROM assets WHERE share_id = ? ORDER BY filename')
          .all(existing.id);
        return response.status(200).json(shareReceipt(existing, bearer, config, existingAssets, true));
      }
      if (pairing.used_at !== null)
        throw new ApiError(409, 'pairing_used', 'The upload token was already used.');
      if (pairing.expires_at <= now())
        throw new ApiError(401, 'pairing_expired', 'The upload token expired.');

      const staging = db
        .prepare('SELECT * FROM staging_uploads WHERE upload_token_hash = ?')
        .get(uploadTokenHash);
      if (staging) {
        if (staging.request_id !== upload.requestId || !safeHashEqual(staging.payload_hash, payloadHash)) {
          throw new ApiError(
            409,
            'idempotency_conflict',
            'This upload token is already bound to a different request.',
          );
        }
        const committed = await waitForCommittedShare(db, uploadTokenHash);
        if (!committed)
          throw new ApiError(
            409,
            'upload_interrupted',
            'The matching upload did not complete. Retry the request.',
          );
        const committedAssets = db
          .prepare('SELECT filename FROM assets WHERE share_id = ? ORDER BY filename')
          .all(committed.id);
        return response.status(200).json(shareReceipt(committed, bearer, config, committedAssets, true));
      }
      const committedAfterStaging = db
        .prepare('SELECT * FROM shares WHERE upload_token_hash = ?')
        .get(uploadTokenHash);
      if (committedAfterStaging) {
        if (
          committedAfterStaging.request_id !== upload.requestId ||
          !safeHashEqual(committedAfterStaging.payload_hash, payloadHash)
        ) {
          throw new ApiError(
            409,
            'idempotency_conflict',
            'This upload token is already bound to a different request.',
          );
        }
        const committedAssets = db
          .prepare('SELECT filename FROM assets WHERE share_id = ? ORDER BY filename')
          .all(committedAfterStaging.id);
        return response
          .status(200)
          .json(shareReceipt(committedAfterStaging, bearer, config, committedAssets, true));
      }

      const estimatedSize = upload.includeArchive ? upload.decodedBytes * 2 + 4096 : upload.decodedBytes;
      const filesystemUsage = await directorySize(config.uploadsDir);
      const id = randomUUID();
      const stagedAt = now();
      db.exec('BEGIN IMMEDIATE');
      try {
        const usage = db.prepare('SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM shares').get().bytes;
        const reserved = db
          .prepare('SELECT COALESCE(SUM(reserved_bytes), 0) AS bytes FROM staging_uploads')
          .get().bytes;
        if (Math.max(filesystemUsage, usage) + reserved + estimatedSize > config.maxStorageBytes) {
          throw new ApiError(507, 'quota_exceeded', 'The sharing service storage quota is full.');
        }
        db.prepare(
          'INSERT INTO staging_uploads (id, upload_token_hash, request_id, payload_hash, created_at, reserved_bytes) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(id, uploadTokenHash, upload.requestId, payloadHash, stagedAt, estimatedSize);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        const concurrent = db
          .prepare('SELECT * FROM staging_uploads WHERE upload_token_hash = ?')
          .get(uploadTokenHash);
        if (concurrent) {
          if (
            concurrent.request_id !== upload.requestId ||
            !safeHashEqual(concurrent.payload_hash, payloadHash)
          ) {
            throw new ApiError(
              409,
              'idempotency_conflict',
              'This upload token is already bound to a different request.',
            );
          }
          const committed = await waitForCommittedShare(db, uploadTokenHash);
          if (!committed)
            throw new ApiError(
              409,
              'upload_interrupted',
              'The matching upload did not complete. Retry the request.',
            );
          const committedAssets = db
            .prepare('SELECT filename FROM assets WHERE share_id = ? ORDER BY filename')
            .all(committed.id);
          return response.status(200).json(shareReceipt(committed, bearer, config, committedAssets, true));
        }
        throw error;
      }

      const publicToken = deriveToken(config.receiptSecret, bearer, upload.requestId, 'public');
      const managementToken = deriveToken(config.receiptSecret, bearer, upload.requestId, 'management');
      const stagingDirectory = path.join(config.uploadsDir, `.staging-${id}`);
      const shareDirectory = path.join(config.uploadsDir, id);
      let byteSize = upload.decodedBytes;
      try {
        await fsp.mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
        await fsp.writeFile(path.join(stagingDirectory, 'prompt.md'), upload.markdown, {
          mode: 0o600,
          flag: 'wx',
        });
        for (const image of upload.images) {
          await fsp.writeFile(path.join(stagingDirectory, image.filename), image.data, {
            mode: 0o600,
            flag: 'wx',
          });
        }
        if (upload.includeArchive) byteSize += await writeArchive(stagingDirectory, upload.images);
        await fsp.rename(stagingDirectory, shareDirectory);
        const finalFilesystemUsage = await directorySize(config.uploadsDir);
        const createdAt = now();
        const expiresAt = createdAt + upload.expiresInDays * 24 * 60 * 60 * 1000;
        const recoveryUntil = createdAt + config.receiptRecoveryMs;
        db.exec('BEGIN IMMEDIATE');
        try {
          const committedUsage = db
            .prepare('SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM shares')
            .get().bytes;
          const otherReservations = db
            .prepare('SELECT COALESCE(SUM(reserved_bytes), 0) AS bytes FROM staging_uploads WHERE id != ?')
            .get(id).bytes;
          if (
            Math.max(finalFilesystemUsage, committedUsage + byteSize) + otherReservations >
            config.maxStorageBytes
          ) {
            throw new ApiError(507, 'quota_exceeded', 'The sharing service storage quota is full.');
          }
          const consumed = db
            .prepare('UPDATE pairings SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?')
            .run(createdAt, pairing.id, createdAt);
          if (consumed.changes !== 1) {
            const current = db
              .prepare('SELECT used_at, expires_at FROM pairings WHERE id = ?')
              .get(pairing.id);
            if (current?.used_at !== null)
              throw new ApiError(409, 'pairing_used', 'The upload token was already used.');
            throw new ApiError(401, 'pairing_expired', 'The upload token expired.');
          }
          db.prepare(
            'INSERT INTO shares (id, public_token_hash, management_token_hash, upload_token_hash, request_id, payload_hash, title, created_at, expires_at, recovery_until, byte_size, has_archive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ).run(
            id,
            tokenHash(publicToken),
            tokenHash(managementToken),
            uploadTokenHash,
            upload.requestId,
            payloadHash,
            upload.title,
            createdAt,
            expiresAt,
            recoveryUntil,
            byteSize,
            upload.includeArchive ? 1 : 0,
          );
          const insertAsset = db.prepare(
            'INSERT INTO assets (share_id, filename, byte_size, width, height) VALUES (?, ?, ?, ?, ?)',
          );
          for (const image of upload.images)
            insertAsset.run(id, image.filename, image.data.length, image.width, image.height);
          db.prepare('DELETE FROM staging_uploads WHERE id = ?').run(id);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          const committed = db
            .prepare('SELECT * FROM shares WHERE upload_token_hash = ?')
            .get(uploadTokenHash);
          if (committed) {
            if (
              committed.request_id !== upload.requestId ||
              !safeHashEqual(committed.payload_hash, payloadHash)
            ) {
              throw new ApiError(
                409,
                'idempotency_conflict',
                'This upload token is already bound to a different request.',
              );
            }
            await fsp.rm(shareDirectory, { recursive: true, force: true });
            db.prepare('DELETE FROM staging_uploads WHERE id = ?').run(id);
            const committedAssets = db
              .prepare('SELECT filename FROM assets WHERE share_id = ? ORDER BY filename')
              .all(committed.id);
            return response.status(200).json(shareReceipt(committed, bearer, config, committedAssets, true));
          }
          throw error;
        }
        response.status(201).json(
          shareReceipt(
            {
              id,
              request_id: upload.requestId,
              title: upload.title,
              created_at: createdAt,
              expires_at: expiresAt,
              byte_size: byteSize,
              has_archive: upload.includeArchive ? 1 : 0,
            },
            bearer,
            config,
            upload.images,
            false,
          ),
        );
      } catch (error) {
        await fsp.rm(stagingDirectory, { recursive: true, force: true });
        await fsp.rm(shareDirectory, { recursive: true, force: true });
        db.prepare('DELETE FROM staging_uploads WHERE id = ?').run(id);
        throw error;
      }
    }),
  );

  app.get('/api/shares/receipt/:requestId', uploadLimiter, (request, response, next) => {
    try {
      const bearer = readBearer(request);
      if (!bearer) throw new ApiError(401, 'invalid_token', 'The upload token is invalid.');
      const requestId = request.params.requestId.toLowerCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(requestId)) {
        throw new ApiError(400, 'invalid_request', 'requestId must be a UUID.');
      }
      const uploadTokenHash = tokenHash(bearer);
      const record = db.prepare('SELECT * FROM shares WHERE upload_token_hash = ?').get(uploadTokenHash);
      if (!record) {
        const pairing = db.prepare('SELECT 1 FROM pairings WHERE token_hash = ?').get(uploadTokenHash);
        if (!pairing) throw new ApiError(401, 'invalid_token', 'The upload token is invalid.');
        throw new ApiError(404, 'receipt_not_found', 'No committed upload receipt was found.');
      }
      if (record.request_id !== requestId)
        throw new ApiError(404, 'receipt_not_found', 'No committed upload receipt was found.');
      if (record.recovery_until <= now())
        throw new ApiError(410, 'recovery_expired', 'The upload receipt recovery window expired.');
      const assets = db
        .prepare('SELECT filename FROM assets WHERE share_id = ? ORDER BY filename')
        .all(record.id);
      response.json(shareReceipt(record, bearer, config, assets, true));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/shares', uploadLimiter, (request, response, next) => {
    try {
      const record = managementRecord(request, db);
      response.json({
        shares: [
          {
            id: record.id,
            url: null,
            title: record.title,
            createdAt: new Date(record.created_at).toISOString(),
            expiresAt: new Date(record.expires_at).toISOString(),
            revokedAt: record.revoked_at === null ? null : new Date(record.revoked_at).toISOString(),
            byteSize: record.byte_size,
          },
        ],
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/shares/:id/revoke', uploadLimiter, (request, response, next) => {
    try {
      const record = managementRecord(request, db);
      if (record.id !== request.params.id) throw new ApiError(404, 'not_found', 'Share not found.');
      const revokedAt = record.revoked_at ?? now();
      if (record.revoked_at === null)
        db.prepare('UPDATE shares SET revoked_at = ? WHERE id = ?').run(revokedAt, record.id);
      response.json({ id: record.id, revokedAt: new Date(revokedAt).toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.use('/s', publicLimiter, (request, response, next) => {
    response.set({
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'private, no-store',
    });
    next();
  });

  app.get(
    '/s/:token/markdown',
    asyncRoute(async (request, response) => {
      const record = publicRecord(request.params.token, db, now());
      if (!record) return response.status(404).type('html').send(unavailablePage());
      response.set({
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': 'attachment; filename="prompt.md"',
      });
      return response.sendFile('prompt.md', {
        root: path.join(config.uploadsDir, record.id),
        dotfiles: 'deny',
      });
    }),
  );

  app.get(
    '/s/:token/assets/:filename',
    asyncRoute(async (request, response) => {
      const record = publicRecord(request.params.token, db, now());
      if (!record || !isSafePngFilename(request.params.filename))
        return response.status(404).type('html').send(unavailablePage());
      const asset = db
        .prepare('SELECT filename FROM assets WHERE share_id = ? AND filename = ?')
        .get(record.id, request.params.filename);
      if (!asset) return response.status(404).type('html').send(unavailablePage());
      response.set({
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="${asset.filename}"`,
      });
      return response.sendFile(asset.filename, {
        root: path.join(config.uploadsDir, record.id),
        dotfiles: 'deny',
      });
    }),
  );

  app.get(
    '/s/:token/archive.zip',
    asyncRoute(async (request, response) => {
      const record = publicRecord(request.params.token, db, now());
      if (!record || !record.has_archive) return response.status(404).type('html').send(unavailablePage());
      response.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="imnota-prompt.zip"',
      });
      return response.sendFile('archive.zip', {
        root: path.join(config.uploadsDir, record.id),
        dotfiles: 'deny',
      });
    }),
  );

  app.get(
    '/s/:token',
    asyncRoute(async (request, response) => {
      const record = publicRecord(request.params.token, db, now());
      if (!record) return response.status(404).type('html').send(unavailablePage());
      const markdown = await fsp.readFile(path.join(config.uploadsDir, record.id, 'prompt.md'), 'utf8');
      const assets = db
        .prepare('SELECT filename, width, height FROM assets WHERE share_id = ? ORDER BY filename')
        .all(record.id);
      return response
        .type('html')
        .send(sharePage(record, renderMarkdown(markdown), assets, request.params.token, config.publicOrigin));
    }),
  );

  app.use('/api', (_request, response) =>
    response.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found.' } }),
  );
  app.use((error, _request, response, _next) => {
    void _next;
    if (error?.type === 'entity.too.large') {
      return response
        .status(413)
        .json({ error: { code: 'payload_too_large', message: 'Request body exceeds the size limit.' } });
    }
    if (error instanceof SyntaxError && 'body' in error) {
      return response
        .status(400)
        .json({ error: { code: 'invalid_request', message: 'Request body is not valid JSON.' } });
    }
    if (error instanceof ApiError) {
      return response.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    console.error(error);
    return response.status(500).json({
      error: { code: 'internal_error', message: 'The sharing service could not complete the request.' },
    });
  });

  return { app, config, db, close: () => db.close() };
}

function readBearer(request) {
  const authorization = request.get('authorization');
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? '');
  return match?.[1];
}

function managementRecord(request, db) {
  const bearer = readBearer(request);
  if (!bearer) throw new ApiError(401, 'invalid_token', 'A valid management token is required.');
  const record = db.prepare('SELECT * FROM shares WHERE management_token_hash = ?').get(tokenHash(bearer));
  if (!record) throw new ApiError(401, 'invalid_token', 'A valid management token is required.');
  return record;
}

function publicRecord(token, db, timestamp) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return undefined;
  return db
    .prepare('SELECT * FROM shares WHERE public_token_hash = ? AND revoked_at IS NULL AND expires_at > ?')
    .get(tokenHash(token), timestamp);
}
