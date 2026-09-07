# Hosted sharing deployment verification

Verified on 2026-09-07 at 22:57 UTC against `https://app.imnota.xyz`.

- Deployed service source: `492c6eae75b2ef901259b62c20695b33553e97df`.
- Hostinger deployment: `01a07e15-0d35-7362-a21a-60e65fc391b5`, completed, Express on Node 22.14.0, entry `src/hostinger.cjs`.
- Private data directory: `/home/u644068606/.imnota-shares`. Runtime startup confirmed storage and metadata-backup initialization. The public document root contained only Hostinger's Passenger routing file; the service's code, database, artifacts and backups are outside it.
- The receipt secret was generated once, stored in the service environment, and backed up encrypted. It was retained across deployments and restart; the database verifies its fingerprint.
- The parent `imnota.xyz` application and stable release were not modified by this deployment.

## Live checks

The compiled desktop `HostedShareClient` uploaded a synthetic 32 × 24 PNG and Markdown, with an optional archive. No user project content was uploaded.

1. Pairing and initial upload succeeded, and the desktop persisted the returned share record.
2. An unauthenticated HTTPS request could read the public page. HSTS, MIME sniffing protection, no-referrer, noindex, frame denial and the early restrictive CSP meta policy were present. Hostinger replaces the original CSP response header; the document policy and `X-Frame-Options: DENY` preserve the intended browser restrictions.
3. Markdown matched exactly. PNG dimensions and decoded pixels matched. The ZIP contained only `prompt.md` and `prompt-001.png`, with exact matching artifact bytes. `Cache-Control: private, no-store, no-transform` prevented the CDN from rewriting the PNG or adding metadata.
4. The same artifacts, SQLite record, recovered receipt URL and local desktop history survived redeployment and an explicit Hostinger process restart.
5. Revocation through the desktop client made the page, Markdown, PNG and archive routes return 404. Local history recorded the revoked state. A second fresh create/read/download/revoke cycle passed on the final deployment.
6. Forged `X-Forwarded-For` values did not change the observed rate-limit bucket.
7. The hourly wake/health cron, `57 * * * *`, produced its first successful recorded result: `status: ok`, 1,214 actual and recorded artifact bytes, and zero reserved bytes. Both synthetic shares remain within their documented cleanup grace period.

The service's 14 automated security tests separately cover expiry, grace-period cleanup, replay, authorization, malformed PNGs, aggregate decompression limits, quotas, concurrency, secret continuity and backups. The real local HTTP contract test covers desktop creation, lost-response recovery and revocation. These checks run alongside application and packaged-platform verification in CI.

## Verification limits

No connected browser was available for a manual recipient-page visual check. Unauthenticated HTTP rendering and downloads were tested; a manual private-browser visual check and human clipboard compatibility trials remain follow-up QA. Provider access-log retention is not controlled by the connector, and paired off-host artifact backups remain the documented operational procedure. See [the runbook](hostinger-deployment.md) for these boundaries and recovery instructions.
