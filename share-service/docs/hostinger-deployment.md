# Hostinger deployment runbook

This is a deployment plan, not evidence of a live deployment. No Hostinger setting, file, process, DNS record, or secret is changed by this package.

## Prerequisites

- Configure `app.imnota.xyz` as its own Node.js application in Hostinger. Do not change the existing parent `imnota.xyz` Node application.
- Use Node 22.13+ or Node 24 LTS, run `npm ci --omit=dev`, and use `npm start` as the start command. There is no build step.
- Keep the deployed package at `/home/u644068606/domains/imnota.xyz/public_html/app`, but set `IMNOTA_SHARE_DATA_DIR=/home/u644068606/.imnota-shares`. The SQLite database and uploads must remain outside `public_html`, the repository, and all static document roots.
- Set the application origin to `https://app.imnota.xyz`, route the Hostinger-assigned application port through its HTTPS proxy, preserve `Host` and `X-Forwarded-Proto`, and set `IMNOTA_SHARE_TRUST_PROXY=loopback` unless Hostinger documents a different trusted proxy range.
- Confirm that the hosting plan provides a persistent Node process, persistent home-directory storage, scheduled jobs, enough disk for the configured quota plus backups, and TLS renewal. If application storage is ephemeral, stop and move artifacts to durable S3-compatible storage before release.

Required environment:

```text
NODE_ENV=production
PORT=<Hostinger-assigned port>
IMNOTA_SHARE_PUBLIC_ORIGIN=https://app.imnota.xyz
IMNOTA_SHARE_DATA_DIR=/home/u644068606/.imnota-shares
IMNOTA_SHARE_TRUST_PROXY=loopback
IMNOTA_SHARE_RECEIPT_RECOVERY_MS=86400000
```

Create the data directory as the application user with mode `0700`. The service creates SQLite and artifact files with private modes. Do not place an `.env` file in the document root; use Hostinger's environment-variable settings.

## Staged release

1. Record the currently deployed release path/version and environment settings. Take and verify a backup as described below.
2. Upload an immutable release directory or extract a tagged archive. Run `npm ci --omit=dev` there.
3. Before routing traffic, run `npm test` in a build workspace with development dependencies. Start the candidate against a new temporary data directory and non-public port, then verify `/health`, pairing, upload, private-browser read, downloads, revoke, and cleanup.
4. Point only the `app.imnota.xyz` Node application at the candidate release and restart it in the Hostinger panel. Do not modify the parent-domain application.
5. Verify `curl --fail --silent --show-error https://app.imnota.xyz/health`, TLS validity, HSTS, CSP, `X-Robots-Tag` on `/new` and share paths, correct `X-Forwarded-Proto`, a full manual share flow, and a 404 after revoke.
6. Keep the prior release directory and compatible backup until the observation window closes.

The health response exposes only service state and aggregate recorded storage bytes. Monitor non-2xx rates, process restarts, disk free space, SQLite write errors, cleanup failures, upload rate-limit volume, certificate expiry, and health latency. Alert before disk usage reaches the configured 2 GiB quota or the hosting account's own limit.

## Cleanup and retention

The running process checks hourly. A share becomes inaccessible exactly at expiry or revocation, then its directory and metadata are deleted after the 24-hour recovery grace period. Active shares are excluded. Expired pairing records are deleted after the same grace period.

Also schedule this command hourly in Hostinger as defense against process downtime:

```sh
cd /home/u644068606/domains/imnota.xyz/public_html/app && npm run cleanup
```

Only one cleanup invocation should normally run at a time. Investigate a non-zero exit or `failedShares` above zero. Compare `/health` `storageBytes` with filesystem use; a persistent mismatch can indicate orphaned files after an interrupted write.

## Backup and recovery

Back up metadata and artifacts together at least daily, encrypt the backup, retain it according to the same privacy policy as active shares, and test restores. A simple consistent low-volume procedure is:

1. Put `app.imnota.xyz` in maintenance mode or stop its Node process so no upload or cleanup can mutate data.
2. Archive `/home/u644068606/.imnota-shares` to a dated file in a private backup location outside `public_html`.
3. Restart the process and verify `/health`.
4. Copy the archive to durable off-host encrypted storage, verify its checksum, and expire old backups on a documented schedule.

To restore, stop the process, preserve the failed data directory for investigation, restore the database plus `uploads/` from the same backup generation, set directory mode `0700`, start the service, check SQLite integrity with `PRAGMA integrity_check`, compare recorded and filesystem storage, then test one known unexpired link. A restored backup can briefly resurrect a share revoked after the backup; review the incident window and reapply known revocations before reopening traffic.

## Rollback

If health or the manual flow fails, remove traffic from the candidate, stop it, point the `app.imnota.xyz` application back to the recorded prior release, restore the prior environment, and restart. Do not roll back the data directory unless the new release changed its schema incompatibly or corrupted data; this version only creates its own initial tables. If data rollback is necessary, keep the failed copy and follow the restore procedure so metadata and artifact files stay paired. Verify health, a known active share, creation/revocation, and parent-domain availability after rollback.

## Release limits requiring follow-up

- Browser pairing is anonymous and protected by origin checks plus rate limits; it does not prove user identity. Abuse monitoring and quota headroom are operational requirements.
- Uploads are bounded JSON envelopes and therefore buffered in memory by Express. The 36 MiB body limit must fit the Hostinger process memory budget and proxy request limit.
- The service validates the PNG signature, IHDR dimensions, filename, and byte limits but does not re-encode images or strip PNG ancillary metadata. The desktop exporter should continue producing clean finalized PNGs. Add server-side re-encoding if uploads from other clients are permitted.
- Receipt recovery requires the desktop to protect the pending upload bearer and UUID for up to 24 hours. They are a sensitive capability during that window and should be removed immediately after the receipt is committed locally.
- Cross-platform Windows, macOS, and Linux desktop end-to-end tests remain release gates after the separate desktop client is integrated. This package's automated tests exercise the HTTP service locally only.
