const ownerMetaCsp =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'self'";

export function ownerPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${ownerMetaCsp}">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Owner console · Imnota</title>
    <link rel="stylesheet" href="/static/owner.css">
    <script type="module" src="/static/owner.js"></script>
  </head>
  <body>
    <main class="owner-shell">
      <section class="boot-screen" data-boot aria-live="polite">
        <p class="wordmark"><img src="/static/imnota-logo.svg" alt="" aria-hidden="true"><span class="wordmark-name">imnota</span><span>owner console</span></p>
        <p class="boot-status">Connecting to the private owner console…</p>
        <noscript><p class="boot-status">Enable JavaScript to use the private owner console.</p></noscript>
      </section>
      <section class="login-screen" data-login hidden aria-labelledby="owner-access-title">
        <p class="wordmark"><img src="/static/imnota-logo.svg" alt="" aria-hidden="true"><span class="wordmark-name">imnota</span><span>owner console</span></p>
        <div class="login-panel">
          <p class="eyebrow">Private service</p>
          <h1 id="owner-access-title">Owner access</h1>
          <p>Use the service access key to inspect lifecycle metadata. Shared content, local paths, and bearer tokens are never displayed here.</p>
          <form data-login-form>
            <label for="access-key">Access key</label>
            <input id="access-key" name="accessKey" type="password" autocomplete="current-password" required>
            <button type="submit">Enter console</button>
          </form>
          <p class="message" role="alert" data-login-error></p>
        </div>
      </section>

      <section class="console" data-dashboard hidden aria-label="Imnota owner console">
        <aside class="console-rail" aria-label="Owner navigation">
          <a class="rail-brand" href="#overview" aria-label="Imnota owner console"><img src="/static/imnota-logo.svg" alt="" aria-hidden="true"><span class="wordmark-name">imnota</span><span>owner</span></a>
          <nav class="console-nav" aria-label="Console sections">
            <button type="button" class="nav-item is-active" data-view-trigger="overview" aria-current="page">Overview</button>
            <button type="button" class="nav-item" data-view-trigger="shares">Shares</button>
            <button type="button" class="nav-item" data-view-trigger="pairing">Pairing</button>
            <button type="button" class="nav-item" data-view-trigger="storage">Storage</button>
          </nav>
          <div class="rail-session">
            <span class="session-dot" aria-hidden="true"></span>
            <span>Session verified</span>
            <button type="button" class="text-button" data-logout>Sign out</button>
          </div>
        </aside>

        <div class="console-main">
          <header class="console-header">
            <div>
              <p class="eyebrow" data-section-kicker>Operational readout</p>
              <h1 data-section-title>Overview</h1>
            </div>
            <div class="header-actions">
              <p class="refresh-stamp" aria-live="polite" data-refreshed-at>Waiting for metadata</p>
              <button class="quiet-button" type="button" data-refresh>Refresh</button>
            </div>
          </header>

          <p class="message dashboard-message" role="alert" data-dashboard-error></p>

          <section class="view is-active" data-view="overview" aria-labelledby="overview-title">
            <h2 class="sr-only" id="overview-title">Service overview</h2>
            <div class="service-strip" data-overview-status aria-live="polite"></div>
            <div class="overview-grid">
              <section class="readout-panel" aria-labelledby="share-pulse-title">
                <div class="panel-heading"><div><p class="eyebrow">Lifecycle</p><h2 id="share-pulse-title">Share status</h2></div><button class="panel-link" type="button" data-open-view="shares">Inspect shares</button></div>
                <div class="readout-list" data-share-pulse></div>
              </section>
              <section class="readout-panel" aria-labelledby="storage-pulse-title">
                <div class="panel-heading"><div><p class="eyebrow">Capacity</p><h2 id="storage-pulse-title">Storage usage</h2></div><button class="panel-link" type="button" data-open-view="storage">Inspect storage</button></div>
                <div class="readout-list" data-storage-pulse></div>
              </section>
              <section class="readout-panel" aria-labelledby="pairing-pulse-title">
                <div class="panel-heading"><div><p class="eyebrow">One-time handoffs</p><h2 id="pairing-pulse-title">Pairing queue</h2></div><button class="panel-link" type="button" data-open-view="pairing">Inspect pairing</button></div>
                <div class="readout-list" data-pairing-pulse></div>
              </section>
            </div>
            <p class="data-note">Request totals count successful service requests, not unique people. This console intentionally excludes private prompt content and access credentials.</p>
          </section>

          <section class="view" data-view="shares" aria-labelledby="shares-title" hidden>
            <div class="section-intro"><div><h2 id="shares-title">Share lifecycle</h2><p>Redacted operational records. Select a row to inspect timestamps, stored size, and request totals.</p></div></div>
            <div class="filter-bar" role="toolbar" aria-label="Filter shares by status">
              <button type="button" class="filter-button is-selected" data-share-filter="all" aria-pressed="true">All</button>
              <button type="button" class="filter-button" data-share-filter="active" aria-pressed="false">Active</button>
              <button type="button" class="filter-button" data-share-filter="expiring" aria-pressed="false">Expiring <span>24h</span></button>
              <button type="button" class="filter-button" data-share-filter="expired" aria-pressed="false">Expired</button>
              <button type="button" class="filter-button" data-share-filter="revoked" aria-pressed="false">Revoked</button>
            </div>
            <div class="table-wrap" role="region" aria-label="Share lifecycle table" tabindex="0"><table class="data-table"><caption class="sr-only">Share lifecycle records</caption><thead><tr><th scope="col">Share</th><th scope="col">State</th><th scope="col">Created</th><th scope="col">Expiry</th><th scope="col">Stored</th><th scope="col">Artifacts</th><th scope="col">Requests</th></tr></thead><tbody data-share-list></tbody></table></div>
            <div class="empty-state" data-shares-empty hidden><strong>No matching shares</strong><span>No lifecycle records match this filter.</span></div>
            <button class="quiet-button load-more" type="button" data-load-more hidden>Load more</button>
          </section>

          <section class="view" data-view="pairing" aria-labelledby="pairing-title" hidden>
            <div class="section-intro"><div><h2 id="pairing-title">Pairing lifecycle</h2><p>One-time codes are never rendered or recoverable from this view.</p></div></div>
            <p class="data-note pairing-limit-note">Latest 100 pairing records, newest first. One-time codes are never rendered or recoverable from this view.</p>
            <div class="table-wrap" role="region" aria-label="Latest 100 pairing lifecycle table" tabindex="0"><table class="data-table"><caption class="sr-only">Latest 100 pairing lifecycle records</caption><thead><tr><th scope="col">Reference</th><th scope="col">State</th><th scope="col">Created</th><th scope="col">Expiry</th><th scope="col">Consumed</th></tr></thead><tbody data-pairing-list></tbody></table></div>
            <div class="empty-state" data-pairings-empty hidden><strong>No pairing records</strong><span>There are no current pairing records to display.</span></div>
          </section>

          <section class="view" data-view="storage" aria-labelledby="storage-title" hidden>
            <div class="section-intro"><div><h2 id="storage-title">Storage and retention</h2><p>Aggregate service storage and the configured automatic retention policy.</p></div></div>
            <div class="storage-layout" data-storage-detail></div>
          </section>
        </div>
      </section>
    </main>

    <dialog class="drawer" data-detail-dialog aria-labelledby="share-detail-title">
      <div class="drawer-header"><div><p class="eyebrow">Share inspection</p><h2 id="share-detail-title" data-detail-title>Share</h2></div><button type="button" class="icon-button" data-close-detail aria-label="Close share details">Close</button></div>
      <div class="drawer-body" data-share-detail></div>
      <div class="drawer-footer" data-detail-actions></div>
    </dialog>

    <dialog class="confirm-dialog" data-revoke-dialog aria-labelledby="revoke-title">
      <form method="dialog" data-revoke-form>
        <p class="eyebrow">Confirm revocation</p>
        <h2 id="revoke-title">Revoke this share?</h2>
        <p data-revoke-share>This immediately disables the shared link.</p>
        <p>Stored artifacts follow the existing automatic retention policy; this action does not delete them.</p>
        <p class="message" role="alert" data-revoke-error></p>
        <div class="dialog-actions"><button type="submit" value="cancel" class="quiet-button">Keep active</button><button type="submit" value="confirm" class="danger-button">Revoke share</button></div>
      </form>
    </dialog>
  </body>
</html>`;
}
