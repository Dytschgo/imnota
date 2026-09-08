# Hostinger deployment runbook

This runbook describes operation of the dedicated `app.imnota.xyz` service. Release verification evidence is recorded separately in `deployment-verification.md`.

## Prerequisites

- Configure `app.imnota.xyz` as its own Node.js application in Hostinger. Do not change the existing parent `imnota.xyz` Node application.
- Use Node 22.13+ or Node 24 LTS and run `npm ci --omit=dev`. Set Hostinger's Express entry file to `src/hostinger.cjs`; its synchronous loader cannot directly require an ESM entry with top-level await. The wrapper imports the server and waits for private-storage preparation before listening. `npm start` runs the same server directly outside Hostinger. The build script performs syntax checks.
- Hostinger manages the deployed package at `/home/u644068606/domains/imnota.xyz/app/hbuilds/current/nodejs`. The public document root `/home/u644068606/domains/imnota.xyz/public_html/app` contains only its generated Passenger routing file. Set `IMNOTA_SHARE_DATA_DIR=/home/u644068606/.imnota-shares`; SQLite, uploads and backups remain outside both the deployed code and every public document root.
- Set the application origin to `https://app.imnota.xyz`, route the Hostinger-assigned application port through its HTTPS proxy, preserve `Host` and `X-Forwarded-Proto`, and set `IMNOTA_SHARE_TRUST_PROXY=loopback` unless Hostinger documents a different trusted proxy range.
- Generate `IMNOTA_SHARE_RECEIPT_SECRET` once with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Store it only in Hostinger's secret environment settings and the encrypted operational backup. Losing or rotating it prevents receipt recovery and changes derived capabilities for retried uploads; do not rotate it as an ordinary deployment step.
- The database stores a SHA-256 fingerprint of that secret and refuses to start with a different key. Restore the original secret with its matching metadata backup; do not remove the fingerprint to bypass a failed restore.
- Confirm that the hosting plan provides a persistent Node process, persistent home-directory storage, scheduled jobs, enough disk for the configured quota plus backups, and TLS renewal. If application storage is ephemeral, stop and move artifacts to durable S3-compatible storage before release.

Required environment:

```text
NODE_ENV=production
PORT=<Hostinger-assigned port>
IMNOTA_SHARE_PUBLIC_ORIGIN=https://app.imnota.xyz
IMNOTA_SHARE_DATA_DIR=/home/u644068606/.imnota-shares
IMNOTA_SHARE_TRUST_PROXY=loopback
IMNOTA_SHARE_RECEIPT_RECOVERY_MS=86400000
IMNOTA_SHARE_RECEIPT_SECRET=<32-random-bytes-as-base64url>
IMNOTA_SHARE_BACKUP_INTERVAL_MS=86400000
IMNOTA_SHARE_BACKUP_RETENTION_MS=2678400000
```

Create the data directory as the application user with mode `0700`. The service creates SQLite and artifact files with private modes. Do not place an `.env` file in the document root; use Hostinger's environment-variable settings.

## Staged release

1. Record the currently deployed release path/version and environment settings. Take and verify a backup as described below.
2. Upload an immutable release directory or extract a tagged archive. Run `npm ci --omit=dev` there.
3. Before routing traffic, run `npm test` in a build workspace with development dependencies. Start the candidate against a new temporary data directory and non-public port, then verify `/health`, pairing, upload, private-browser read, downloads, revoke, and cleanup.
4. Point only the `app.imnota.xyz` Node application at the candidate release and restart it in the Hostinger panel. Do not modify the parent-domain application.
5. Verify `curl --fail --silent --show-error https://app.imnota.xyz/health`, TLS validity, HSTS, CSP, `X-Robots-Tag` on `/new` and share paths, correct `X-Forwarded-Proto`, a full manual share flow, and a 404 after revoke.
6. Keep the prior release directory and compatible backup until the observation window closes.

Hostinger's CDN currently rewrites the application `Content-Security-Policy` response header to `upgrade-insecure-requests`. Helmet still emits the complete header for direct and future-compatible hosting, and every HTML document places the equivalent resource policy immediately after its charset declaration as a browser fallback. Because `frame-ancestors` is not supported in a CSP meta element, the preserved `X-Frame-Options: DENY` header supplies framing protection behind the CDN. Recheck this behavior after provider or CDN configuration changes.

The health response exposes only service state plus actual, recorded, and reserved aggregate storage bytes. Monitor non-2xx rates, process restarts, disk free space, SQLite write and backup errors, cleanup failures, upload rate-limit volume, certificate expiry, and health latency. Alert before disk usage reaches the configured 2 GiB quota or the hosting account's own limit. Monitor the private backup directory separately because backups do not count toward the upload quota.

## Cleanup and retention

### Provider access logs

The application does not log request URLs, authorization headers or artifact content. [Hostinger documents automatic server access logs](https://www.hostinger.com/support/5650167-how-to-use-the-analytics-section-on-hpanel-at-hostinger/), including requested resources and visitor IP addresses. These logs can therefore contain public share capabilities in `/s/<token>` paths. The desktop confirmation discloses provider logging; do not promise that links are absent from hosting logs.

Keep hPanel log access limited to the account owner and necessary service operators. Do not enable analytics integrations or forward access logs to third parties. Redact `/s/<token>` to `/s/[redacted]` before copying logs into support tickets, issues or diagnostics; never copy authorization headers. Avoid downloading raw access logs. Delete any temporary diagnostic copies within 24 hours and retain only aggregate counters for monitoring. The connector does not expose a provider retention or URL-redaction setting, so provider-side retention is not verified or represented as an application guarantee. Review the hosting provider's log policy when changing the service's privacy commitments.

The process checks retention at startup and hourly while running. A share becomes inaccessible exactly at expiry or revocation, then its directory and metadata are deleted after the 24-hour recovery grace period. Active shares are excluded. Expired pairing records are deleted after the same grace period. Uploads reserve quota in SQLite before private staging files are written. Startup reconciliation aggressively removes incomplete staging reservations and unreferenced directories left by a prior process; hourly reconciliation removes only entries older than the grace period so it cannot delete a live upload.

An hourly Hostinger cron request wakes an idled Passenger process, which runs retention maintenance before listening. It requires no application credential in the cron command:

```sh
/usr/bin/curl --fail --silent --show-error --max-time 45 https://app.imnota.xyz/health
```

The configured schedule is `57 * * * *`. Investigate failed health responses and scheduled cleanup errors. Compare `/health` `storageBytes` with recorded bytes; a persistent mismatch can indicate orphaned files after an interrupted write. For manual `npm run cleanup`, use the current deployed code directory and securely supply the same environment as the running application.

## Backup and recovery

The service uses SQLite `VACUUM INTO` to create a transactionally consistent metadata backup in `/home/u644068606/.imnota-shares/backups` when no completed backup exists from the preceding 24 hours. Startup and daily timers check whether it is due, so repeated process wakeups do not multiply backup copies. It writes through a private temporary file, atomically renames the completed backup, and deletes metadata backups older than 31 days. `npm run backup` forces the same bounded operation. These local copies protect SQLite metadata but are not a complete disaster-recovery set without their matching artifacts.

Back up metadata and artifacts together at least daily, encrypt the backup, keep off-host copies no longer than 31 days, and test restores. A simple consistent low-volume procedure is:

1. Put `app.imnota.xyz` in maintenance mode or stop its Node process so no upload or cleanup can mutate data.
2. Run `npm run backup`, then archive its newest completed metadata backup together with `uploads/` to a dated file in a private backup location outside `public_html`. Do not copy a `.pending-*` backup.
3. Restart the process and verify `/health`.
4. Copy the archive to durable off-host encrypted storage, verify its checksum, and expire old backups on a documented schedule.

To restore, stop the process, preserve the failed data directory for investigation, restore the database plus `uploads/` from the same backup generation, set directory mode `0700`, start the service, check SQLite integrity with `PRAGMA integrity_check`, compare recorded and filesystem storage, then test one known unexpired link. A restored backup can briefly resurrect a share revoked after the backup; review the incident window and reapply known revocations before reopening traffic.

## Rollback

The bundle-sharing update adds sender and logical metadata byte columns plus bundle, owner-session, login-throttle and aggregate-usage tables. Migrations are additive and transactional. Keep the private owner hash file and matching receipt secret alongside recovery material. `storageBytes` and `recordedBytes` still describe downloadable artifacts; effective quota use is `max(storageBytes, recordedBytes) + metadataBytes + reservedBytes`. Metadata includes the per-bundle Markdown stored in SQLite. Older service code can read the new database but does not charge those bytes; stop new uploads during an old-code rollback until quota enforcement is restored.

If health or the manual flow fails, remove traffic from the candidate, stop it, point the `app.imnota.xyz` application back to the recorded prior release, restore the prior environment, and restart. Do not roll back the data directory unless the new release changed its schema incompatibly or corrupted data. If data rollback is necessary, keep the failed copy and follow the restore procedure so metadata and artifact files stay paired. Verify health, a known active share, creation/revocation, and parent-domain availability after rollback.

## Owner dashboard

`/owner` is restricted to the site owner. Provision a random 32-byte access key privately and store only its lowercase SHA-256 hex digest in `<dataDir>/owner-access-key.sha256`, mode `0600`. The environment variable `IMNOTA_OWNER_ACCESS_KEY_SHA256` is a fallback when the file is absent. Missing configuration disables owner access. Do not replace the existing receipt secret or copy masked environment values.

`npm run provision-owner` creates a new hash file without overwriting an existing one and prints the key once. Run this only in a private terminal whose output is not retained or published, then save the key in the owner's password manager. Do not run it in CI, an output-capturing cron job, or a public deployment log. A reviewed provisioning process may instead generate the key locally and transfer only its hash to the private directory.

Owner sessions use a Secure, HttpOnly, SameSite=Strict cookie, with an eight-hour absolute expiry and a thirty-minute idle expiry by default. Logout and revocation require both the exact configured Origin and a per-session CSRF token. Changing the owner hash and restarting invalidates existing sessions. Keep the access key private; it grants management access to all hosted shares.

The dashboard reports successful GET requests, excludes HEAD requests, and does not claim unique visitors. Image requests include automatic page rendering, and Markdown requests include copying. Counters store no IP address or user-agent identifier and are deleted with their share. Old links start at zero when tracking begins. Provider access logs remain separate.

## Release limits requiring follow-up

- Browser pairing is anonymous and protected by origin checks plus rate limits; it does not prove user identity. Abuse monitoring and quota headroom are operational requirements.
- Uploads are bounded JSON envelopes and therefore buffered in memory by Express. Rate limiting and a four-upload concurrency gate run before parsing, but the 36 MiB body limit still must fit the Hostinger process memory budget and proxy request limit.
- PNG work is capped at 16 megapixels/64 MiB inflated per image and 64 megapixels/256 MiB inflated per bundle. The server completes structural preflight for the manifest and enforces both aggregate limits before beginning pixel decoding.
- PNG normalization deliberately rejects interlaced files and converts accepted files to 8-bit RGBA. This is compatible with the current desktop canvas exporter but should be retested if the exporter changes.
- Receipt recovery requires the desktop to protect the pending upload bearer and UUID for up to 24 hours. They are a sensitive capability during that window and should be removed immediately after the receipt is committed locally.
- The default in-memory rate-limit counters assume one Node process. Multiple instances require a shared rate-limit store before traffic is distributed across them.
- Cross-platform Windows, macOS, and Linux desktop end-to-end tests remain release gates after the separate desktop client is integrated. This package's automated tests exercise the HTTP service locally only.
