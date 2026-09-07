# Imnota share service

This standalone Node.js service publishes an explicitly selected, finalized Imnota prompt bundle at an unguessable read-only URL. It accepts generated Markdown and PNGs only. It does not accept project folders, source screenshots outside the bundle, recovery data, annotation/drawing source, settings, HTML, SVG, or uploaded archives.

## Local development

Node 22.13 or newer is required because metadata uses the built-in `node:sqlite` API.

```sh
npm ci
npm test
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
IMNOTA_SHARE_PUBLIC_ORIGIN=http://localhost:3000 IMNOTA_SHARE_DATA_DIR=./var IMNOTA_SHARE_RECEIPT_SECRET=paste-generated-value npm start
```

Open `http://localhost:3000/new`, create a one-time code, and submit a bundle using the API below. The production default data path is `$HOME/.imnota-shares`, outside the application source directory. Set `IMNOTA_SHARE_DATA_DIR` explicitly in production.

## API contract

All errors use `{ "error": { "code": "...", "message": "..." } }`. Rate-limited responses include `Retry-After`. Unknown, expired, and revoked public links all return the same 404 page to avoid revealing whether a share existed.

### Pair a browser

`GET /new` shows the pairing UI. Its same-origin script sends `POST /api/pairing` with `{}`. The POST requires an `Origin` exactly matching `IMNOTA_SHARE_PUBLIC_ORIGIN` and returns:

```json
{
  "pairingId": "6f075163-b43d-4a4a-88ba-9c37fcf13bfa",
  "uploadToken": "43-character-base64url-token",
  "expiresAt": "2026-09-08T12:10:00.000Z"
}
```

The upload token contains 256 random bits, expires after 10 minutes by default, and is consumed atomically by one successful upload. The database stores its SHA-256 hash. No cookie or permanent desktop secret is used.

### Create a share

`POST /api/shares` requires `Authorization: Bearer <uploadToken>` and `Content-Type: application/json`:

```json
{
  "requestId": "3e750250-9f46-4d12-96bb-c265c9a93c99",
  "title": "Checkout prompt",
  "markdown": "# Implement checkout\n\nUse the attached reference.",
  "images": [{ "filename": "prompt-001.png", "dataBase64": "iVBORw0KGgo..." }],
  "includeArchive": true,
  "expiresInDays": 30
}
```

Image filenames must be 1–100 ASCII characters, contain no path, match `[A-Za-z0-9][A-Za-z0-9._-]*.png`, and be unique without regard to case. The Markdown download always uses `prompt.md`. `includeArchive` creates a ZIP on the server; compressed input is never accepted.

The response is:

```json
{
  "id": "625c0b65-94a6-42ef-a34a-e5e52479319f",
  "url": "https://app.imnota.xyz/s/<public-token>",
  "expiresAt": "2026-10-08T12:00:00.000Z",
  "managementToken": "separate-43-character-base64url-token",
  "recovered": false,
  "artifacts": {
    "markdownUrl": "https://app.imnota.xyz/s/<public-token>/markdown",
    "imageUrls": ["https://app.imnota.xyz/s/<public-token>/assets/prompt-001.png"],
    "archiveUrl": "https://app.imnota.xyz/s/<public-token>/archive.zip"
  }
}
```

The public and management tokens are separate, domain-separated HMAC-SHA-256 outputs derived from a private 256-bit server secret, the random 256-bit upload capability, and the client-generated UUID. Only their SHA-256 hashes are stored. The server secret is never distributed to the desktop. The client must retain the URL and management token in local share metadata; neither can be recovered from the service database alone.

Limits are 200 title characters, 1 MiB of Markdown, 20 PNGs, 10 MiB per PNG, 25 MiB per uploaded and normalized bundle, 10,000 pixels per image dimension, 16 megapixels per image, 64 MiB of inflated scanline data, a 36 MiB encoded JSON body, four concurrent body parsers, and 1–30 days of retention (30 by default). The service validates the complete PNG chunk stream, every CRC, IDAT decompression length, IEND, and absence of trailing data. It rejects interlaced PNGs so inflation remains strictly bounded, then decodes and re-encodes accepted images as 8-bit RGBA PNGs without ancillary metadata. Environment variables can lower or raise the limits, but a production change needs matching capacity and abuse review. Upload is one request and has no resumable/chunked protocol. The desktop may cancel it by aborting the HTTP request. Cancellation is an ambiguous transport outcome until receipt recovery confirms whether the server committed it.

Before upload, the client persists the pairing bearer and `requestId` as a pending recovery capability. A successful initial POST returns `recovered: false` with status 201. Repeating the same bearer, UUID, and normalized payload within 24 hours is one logical upload and returns the original receipt with status 200 and `recovered: true`; it never creates a second share. If the response is lost or the client restarts without retained artifacts, it can send `GET /api/shares/receipt/:requestId` with the original upload bearer and no body. That returns the same 200 receipt with `recovered: true`. The client deletes the pending capability after saving the receipt or when recovery expires.

Expected upload codes are `invalid_token` or `pairing_expired` (401), `pairing_used`, `idempotency_conflict`, or `upload_interrupted` (409), `recovery_expired` (410), `invalid_request` (400), `payload_too_large` (413), `rate_limited` (429), `server_busy` (503), and `quota_exceeded` (507). Receipt lookup additionally uses `receipt_not_found` (404). The recovery window defaults to 24 hours.

### Read and manage

- `GET /s/:token` renders sanitized Markdown, PNG previews, downloads, and the expiry date.
- `GET /s/:token/markdown` downloads `prompt.md`.
- `GET /s/:token/assets/:filename` serves a validated file as `image/png`.
- `GET /s/:token/archive.zip` downloads the optional server-generated archive.
- `GET /api/shares` with a management bearer returns the single record controlled by that token. Its `url` is `null`; raw public tokens are deliberately unrecoverable and the desktop holds the URL locally.
- `GET /api/shares/receipt/:requestId` with the original upload bearer recovers a committed receipt for 24 hours without resending artifact data.
- `POST /api/shares/:id/revoke` with that share's management bearer immediately disables public access and is idempotent.

There are no public indexes, sitemaps, discovery APIs, analytics, or recipient accounts. Share pages send `X-Robots-Tag: noindex, nofollow`, `Cache-Control: private, no-store`, a restrictive CSP, frame restrictions, no-referrer policy, MIME sniffing protection, and other Helmet defaults. `/health` reports actual artifact bytes, committed metadata bytes, and reserved in-progress bytes without exposing paths or names.

## Operations

The process creates a consistent private SQLite backup on startup and daily, pruning copies older than 31 days. `npm run backup` runs the same operation manually. See [Hostinger deployment](docs/hostinger-deployment.md) for the production directory, environment, TLS proxy, paired artifact backups, restore, cleanup, monitoring, and rollback procedure.
