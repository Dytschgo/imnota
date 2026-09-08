export function mountOwnerConsole(root = document) {
  const loginPanel = root.querySelector('[data-login]');
  if (!loginPanel) return undefined;

  const bootScreen = root.querySelector('[data-boot]');
  const dashboard = root.querySelector('[data-dashboard]');
  const loginForm = root.querySelector('[data-login-form]');
  const loginError = root.querySelector('[data-login-error]');
  const dashboardError = root.querySelector('[data-dashboard-error]');
  const shareList = root.querySelector('[data-share-list]');
  const pairingList = root.querySelector('[data-pairing-list]');
  const sharesEmpty = root.querySelector('[data-shares-empty]');
  const pairingsEmpty = root.querySelector('[data-pairings-empty]');
  const loadMore = root.querySelector('[data-load-more]');
  const refreshButton = root.querySelector('[data-refresh]');
  const detailDialog = root.querySelector('[data-detail-dialog]');
  const revokeDialog = root.querySelector('[data-revoke-dialog]');
  const revokeForm = root.querySelector('[data-revoke-form]');
  const refreshedAt = root.querySelector('[data-refreshed-at]');
  let csrfToken;
  let nextCursor;
  let requestGeneration = 0;
  let selectedShare;
  let returnFocus;
  let activeFilter = 'all';
  let revocationPending = false;
  let revokeOperation = 0;
  let loginOperation = 0;
  let loadMoreOperation = 0;
  let signingOut = false;

  const beginRequest = () => ++requestGeneration;
  const isCurrent = (generation) => generation === requestGeneration;

  async function api(path, options = {}) {
    const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...options });
    if (response.status === 204) return undefined;
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error('The service returned an invalid response.');
    }
    if (!response.ok)
      throw Object.assign(new Error(body?.error?.message || 'The request failed.'), {
        status: response.status,
      });
    return body;
  }

  function setBusy(busy, label, generation) {
    if (generation !== undefined && !isCurrent(generation)) return;
    dashboard.setAttribute('aria-busy', String(busy));
    refreshButton.disabled = busy;
    if (label) refreshedAt.textContent = label;
  }

  function number(value) {
    return new Intl.NumberFormat().format(value);
  }

  function bytes(value) {
    if (value < 1024) return `${number(value)} B`;
    if (value < 1024 * 1024) return `${number(Math.round(value / 1024))} KB`;
    return new Intl.NumberFormat(undefined, {
      style: 'unit',
      unit: 'megabyte',
      maximumFractionDigits: 1,
    }).format(value / (1024 * 1024));
  }

  function duration(value) {
    const minutes = Math.round(value / 60_000);
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 24 * 60) return `${Math.round(minutes / 60)} hours`;
    return `${Math.round(minutes / (24 * 60))} days`;
  }

  function date(value) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(value),
    );
  }

  function el(name, className, text) {
    const element = root.createElement(name);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  function setRevocationPending(pending) {
    revocationPending = pending;
    revokeDialog.setAttribute('aria-busy', String(pending));
    for (const button of revokeForm.querySelectorAll('button')) button.disabled = pending;
  }

  function setSigningOut(pending) {
    signingOut = pending;
    dashboard.dataset.signingOut = String(pending);
    for (const button of dashboard.querySelectorAll(
      '[data-view-trigger], [data-open-view], [data-share-filter], [data-refresh], [data-load-more], [data-logout], [data-close-detail]',
    )) {
      button.disabled = pending;
    }
  }

  function clearPrivateMetadata() {
    returnFocus = undefined;
    selectedShare = undefined;
    setRevocationPending(false);
    closeDialog(detailDialog);
    closeDialog(revokeDialog);
    shareList.replaceChildren();
    pairingList.replaceChildren();
    root.querySelector('[data-overview-status]').replaceChildren();
    root.querySelector('[data-share-pulse]').replaceChildren();
    root.querySelector('[data-storage-pulse]').replaceChildren();
    root.querySelector('[data-pairing-pulse]').replaceChildren();
    root.querySelector('[data-storage-detail]').replaceChildren();
    root.querySelector('[data-share-detail]').replaceChildren();
    root.querySelector('[data-detail-actions]').replaceChildren();
    root.querySelector('[data-detail-title]').textContent = 'Share';
    root.querySelector('[data-revoke-share]').textContent = 'This immediately disables the shared link.';
    root.querySelector('[data-revoke-error]').textContent = '';
    dashboardError.textContent = '';
    refreshedAt.textContent = 'Waiting for metadata';
    sharesEmpty.hidden = true;
    pairingsEmpty.hidden = true;
    loadMore.hidden = true;
    loadMore.disabled = false;
    nextCursor = undefined;
  }

  function showLogin(message = '') {
    beginRequest();
    csrfToken = undefined;
    setSigningOut(false);
    clearPrivateMetadata();
    bootScreen.hidden = true;
    dashboard.hidden = true;
    dashboard.setAttribute('aria-busy', 'false');
    loginPanel.hidden = false;
    loginError.textContent = message;
    loginForm.elements.accessKey.focus();
  }

  function statusLabel(status, expiresSoon = false) {
    if (status === 'active' && expiresSoon) return 'Expiring';
    return status[0].toUpperCase() + status.slice(1);
  }

  function badge(status, expiresSoon = false) {
    return el(
      'span',
      `status-badge status-${expiresSoon ? 'expiring' : status}`,
      statusLabel(status, expiresSoon),
    );
  }

  function renderReadout(target, items) {
    target.replaceChildren();
    for (const [label, value, note] of items) {
      const row = el('div', 'readout-row');
      row.append(el('span', 'readout-label', label), el('strong', 'readout-value', value));
      if (note) row.append(el('span', 'readout-note', note));
      target.append(row);
    }
  }

  function renderOverview(value) {
    const status = root.querySelector('[data-overview-status]');
    status.replaceChildren(
      el('div', 'status-rail'),
      el('div', 'service-state', 'Service data updated'),
      el(
        'p',
        'service-copy',
        `Last refreshed ${date(value.checkedAt)}. Storage values are service aggregates, not live health monitoring.`,
      ),
    );
    renderReadout(root.querySelector('[data-share-pulse]'), [
      ['Active', number(value.shares.active), 'Available shared links'],
      ['Expiring', number(value.shares.expiring), 'Within the next 24 hours'],
      [
        'Expired / revoked',
        number(value.shares.expired + value.shares.revoked),
        'Lifecycle records retained by policy',
      ],
    ]);
    renderReadout(root.querySelector('[data-storage-pulse]'), [
      [
        'Filesystem',
        bytes(value.storage.filesystemBytes),
        `of ${bytes(value.storage.capacityBytes)} configured capacity`,
      ],
      ['Accounted quota', bytes(accountedStorage(value)), 'Payload, metadata, and reserved uploads'],
      ['Reserved', bytes(value.storage.reservedBytes), 'Staged uploads not yet committed'],
    ]);
    renderReadout(root.querySelector('[data-pairing-pulse]'), [
      ['Waiting', number(value.pairing.waiting), 'Unconsumed one-time pairings'],
      ['Consumed', number(value.pairing.consumed), 'Codes already used once'],
      ['Expired', number(value.pairing.expired), 'Unavailable pairing records'],
    ]);
    refreshedAt.textContent = `Last refreshed ${date(value.checkedAt)}`;
    renderStorage(value);
  }

  function renderOverviewUnavailable(message) {
    const status = root.querySelector('[data-overview-status]');
    status.replaceChildren(
      el('div', 'status-rail'),
      el('div', 'service-state is-warning', 'Service data unavailable'),
      el('p', 'service-copy', `Storage usage could not be refreshed: ${message}`),
    );
    renderReadout(root.querySelector('[data-share-pulse]'), [
      ['Active', 'Unavailable'],
      ['Expiring', 'Unavailable'],
      ['Expired / revoked', 'Unavailable'],
    ]);
    renderReadout(root.querySelector('[data-storage-pulse]'), [
      ['Filesystem', 'Unavailable'],
      ['Accounted quota', 'Unavailable'],
      ['Reserved', 'Unavailable'],
    ]);
    renderReadout(root.querySelector('[data-pairing-pulse]'), [
      ['Waiting', 'Unavailable'],
      ['Consumed', 'Unavailable'],
      ['Expired', 'Unavailable'],
    ]);
    root
      .querySelector('[data-storage-detail]')
      .replaceChildren(
        el('p', 'data-note', 'Storage usage is unavailable until the service snapshot can be refreshed.'),
      );
    refreshedAt.textContent = 'Last refreshed unavailable.';
  }

  function accountedStorage(value) {
    return value.storage.recordedBytes + value.storage.metadataBytes + value.storage.reservedBytes;
  }

  function renderStorage(value) {
    const target = root.querySelector('[data-storage-detail]');
    const accounted = accountedStorage(value);
    const isOverLimit = accounted > value.storage.capacityBytes;
    const details = [
      [
        'Filesystem total',
        bytes(value.storage.filesystemBytes),
        'Actual files under managed service storage.',
      ],
      ['Recorded payload', bytes(value.storage.recordedBytes), 'Committed prompt-bundle artifact bytes.'],
      ['Metadata', bytes(value.storage.metadataBytes), 'Stored service metadata bytes.'],
      ['Reserved', bytes(value.storage.reservedBytes), 'Upload capacity currently reserved.'],
      ['Accounted quota total', bytes(accounted), 'Payload, metadata, and reservations combined.'],
    ];
    const usage = el('section', 'storage-panel');
    usage.append(el('p', 'eyebrow', 'Quota accounting'), el('h3', '', 'Managed storage'));
    const meter = el('progress', `storage-meter${isOverLimit ? ' is-over-limit' : ''}`);
    meter.max = value.storage.capacityBytes;
    meter.value = Math.min(accounted, value.storage.capacityBytes);
    meter.setAttribute('aria-label', 'Quota-accounted storage used');
    const quotaStatus = el(
      'p',
      `capacity-copy${isOverLimit ? ' is-over-limit' : ''}`,
      isOverLimit
        ? `Over configured limit by ${bytes(accounted - value.storage.capacityBytes)}. New uploads may be rejected.`
        : `${bytes(accounted)} of ${bytes(value.storage.capacityBytes)} quota-accounted storage`,
    );
    usage.append(meter, quotaStatus);
    const list = el('dl', 'storage-list');
    for (const [label, amount, note] of details) {
      const row = el('div');
      row.append(el('dt', '', label), el('dd', '', amount), el('p', '', note));
      list.append(row);
    }
    usage.append(list);
    const policy = el('section', 'storage-panel');
    policy.append(
      el('p', 'eyebrow', 'Retention'),
      el('h3', '', 'Automatic policy'),
      el(
        'p',
        'policy-copy',
        `The server evaluates cleanup every ${duration(value.retention.cleanupIntervalMs)}. Expired and revoked records become eligible after a ${duration(value.retention.cleanupGraceMs)} grace period.`,
      ),
    );
    const eligible = el('div', 'eligible-readout');
    eligible.append(
      el('strong', '', number(value.shares.cleanupEligible + value.pairing.cleanupEligible)),
      el('span', '', 'records currently eligible for automatic cleanup'),
    );
    policy.append(
      eligible,
      el(
        'p',
        'data-note',
        'Manual cleanup is intentionally not exposed in this console. No cleanup result history is recorded by the service.',
      ),
    );
    target.replaceChildren(usage, policy);
  }

  function rowCell(value, className) {
    const cell = el('td', className);
    cell.append(value);
    return cell;
  }

  function renderShare(share) {
    const row = root.createElement('tr');
    const open = el('button', 'table-link');
    open.type = 'button';
    open.setAttribute('aria-label', `${share.title}, ${share.reference}`);
    open.append(el('span', 'share-title', share.title), el('span', 'share-reference', share.reference));
    open.addEventListener('click', (event) => openShareDetail(share, event.currentTarget));
    row.append(
      rowCell(open),
      rowCell(badge(share.status, share.expiresSoon)),
      rowCell(root.createTextNode(date(share.createdAt)), 'numeric-cell'),
      rowCell(root.createTextNode(date(share.expiresAt)), 'numeric-cell'),
      rowCell(root.createTextNode(bytes(share.storedBytes)), 'numeric-cell'),
      rowCell(root.createTextNode(number(share.artifactCount)), 'numeric-cell'),
      rowCell(
        root.createTextNode(
          number(
            share.usage.pageViews +
              share.usage.markdownRequests +
              share.usage.pngRequests +
              share.usage.zipRequests,
          ),
        ),
        'numeric-cell',
      ),
    );
    return row;
  }

  function detailRow(label, value) {
    const row = el('div', 'detail-row');
    row.append(el('dt', '', label), el('dd', '', value));
    return row;
  }

  function openShareDetail(share, trigger) {
    selectedShare = share;
    returnFocus = trigger;
    root.querySelector('[data-detail-title]').textContent = share.title;
    const details = root.querySelector('[data-share-detail]');
    const list = el('dl', 'detail-list');
    list.append(
      detailRow('Reference', share.reference),
      detailRow('Share ID', share.id),
      detailRow('State', statusLabel(share.status, share.expiresSoon)),
      detailRow('Created', date(share.createdAt)),
      detailRow('Expires', date(share.expiresAt)),
      detailRow('Revoked', share.revokedAt ? date(share.revokedAt) : 'Not revoked'),
      detailRow('Stored size', bytes(share.storedBytes)),
      detailRow('Artifact count', number(share.artifactCount)),
      detailRow('Archive included', share.hasArchive ? 'Yes' : 'No'),
      detailRow('Page requests', number(share.usage.pageViews)),
      detailRow('Markdown requests', number(share.usage.markdownRequests)),
      detailRow('PNG requests', number(share.usage.pngRequests)),
      detailRow('ZIP requests', number(share.usage.zipRequests)),
      detailRow(
        'Last successful request',
        share.usage.lastAccessedAt ? date(share.usage.lastAccessedAt) : 'No recorded request',
      ),
    );
    details.replaceChildren(
      list,
      el(
        'p',
        'data-note',
        'Request totals are service events, not unique people. No access token, prompt content, filename, or local path is available in this view.',
      ),
    );
    const actions = root.querySelector('[data-detail-actions]');
    actions.replaceChildren();
    if (share.status === 'active') {
      const revoke = el('button', 'danger-button', 'Revoke share');
      revoke.type = 'button';
      revoke.addEventListener('click', () => {
        closeDialog(detailDialog);
        root.querySelector('[data-revoke-share]').textContent =
          `You are revoking ${share.title} (${share.reference}). This immediately disables the shared link.`;
        revokeDialog.showModal();
      });
      actions.append(revoke);
    }
    detailDialog.showModal();
  }

  function closeDetail() {
    closeDialog(detailDialog);
  }

  async function loadOverviewPanel(generation) {
    try {
      const overview = await api('/api/owner/overview');
      if (isCurrent(generation)) renderOverview(overview);
    } catch (error) {
      if (!isCurrent(generation)) return;
      if (error.status === 401) return showLogin('Your owner session expired. Sign in again to continue.');
      renderOverviewUnavailable(error.message);
    }
  }

  async function loadSharesPanel(generation) {
    try {
      const body = await api(`/api/owner/shares?status=${encodeURIComponent(activeFilter)}&limit=50`);
      if (isCurrent(generation)) renderShares(body, false);
    } catch (error) {
      if (!isCurrent(generation)) return;
      if (error.status === 401) return showLogin('Your owner session expired. Sign in again to continue.');
      dashboardError.textContent = `Shares could not be refreshed: ${error.message}`;
    }
  }

  async function loadPairingsPanel(generation) {
    try {
      const body = await api('/api/owner/pairings');
      if (isCurrent(generation)) renderPairings(body);
    } catch (error) {
      if (!isCurrent(generation)) return;
      if (error.status === 401) return showLogin('Your owner session expired. Sign in again to continue.');
      dashboardError.textContent = `Pairing records could not be refreshed: ${error.message}`;
    }
  }

  async function refresh({ includeLists = false } = {}) {
    if (signingOut) return;
    const generation = beginRequest();
    dashboardError.textContent = '';
    setBusy(true, 'Refreshing metadata…', generation);
    try {
      const loads = [loadOverviewPanel(generation)];
      if (includeLists || !root.querySelector('[data-view="shares"]').hidden) {
        loads.push(loadSharesPanel(generation));
      }
      if (includeLists || !root.querySelector('[data-view="pairing"]').hidden) {
        loads.push(loadPairingsPanel(generation));
      }
      await Promise.all(loads);
    } finally {
      setBusy(false, undefined, generation);
    }
  }

  function renderShares(body, append) {
    if (!append) shareList.replaceChildren();
    shareList.append(...body.shares.map(renderShare));
    sharesEmpty.hidden = shareList.rows.length > 0;
    nextCursor = body.nextCursor;
    loadMore.hidden = !nextCursor;
  }

  function renderPairings(body) {
    pairingList.replaceChildren(...body.pairings.map(renderPairing));
    pairingsEmpty.hidden = body.pairings.length > 0;
  }

  function renderPairing(pairing) {
    const row = root.createElement('tr');
    row.append(
      rowCell(root.createTextNode(pairing.reference)),
      rowCell(badge(pairing.status)),
      rowCell(root.createTextNode(date(pairing.createdAt)), 'numeric-cell'),
      rowCell(root.createTextNode(date(pairing.expiresAt)), 'numeric-cell'),
      rowCell(root.createTextNode(pairing.usedAt ? date(pairing.usedAt) : 'Not consumed'), 'numeric-cell'),
    );
    return row;
  }

  async function loadMoreShares() {
    if (!nextCursor || signingOut) return;
    const generation = beginRequest();
    const operation = ++loadMoreOperation;
    dashboardError.textContent = '';
    loadMore.disabled = true;
    try {
      const body = await api(
        `/api/owner/shares?status=${encodeURIComponent(activeFilter)}&limit=50&cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (!isCurrent(generation)) return;
      renderShares(body, true);
    } catch (error) {
      if (!isCurrent(generation)) return;
      if (error.status === 401) return showLogin('Your owner session expired. Sign in again to continue.');
      dashboardError.textContent = error.message;
    } finally {
      if (operation === loadMoreOperation && !signingOut) loadMore.disabled = false;
    }
  }

  async function establishSession() {
    if (signingOut) return;
    const generation = beginRequest();
    setBusy(true, 'Checking owner session…', generation);
    try {
      const session = await api('/api/owner/session');
      if (!isCurrent(generation)) return;
      csrfToken = session.csrfToken;
      bootScreen.hidden = true;
      loginPanel.hidden = true;
      dashboard.hidden = false;
      await refresh({ includeLists: true });
    } catch (error) {
      if (!isCurrent(generation)) return;
      if (error.status === 401) return showLogin();
      return showLogin(error.message);
    } finally {
      setBusy(false, undefined, generation);
    }
  }

  function activateView(view) {
    if (signingOut) return;
    for (const element of root.querySelectorAll('[data-view]')) {
      const selected = element.dataset.view === view;
      element.hidden = !selected;
      element.classList.toggle('is-active', selected);
    }
    for (const trigger of root.querySelectorAll('[data-view-trigger]')) {
      const selected = trigger.dataset.viewTrigger === view;
      trigger.classList.toggle('is-active', selected);
      if (selected) trigger.setAttribute('aria-current', 'page');
      else trigger.removeAttribute('aria-current');
    }
    root.querySelector('[data-section-title]').textContent = view[0].toUpperCase() + view.slice(1);
    root.querySelector('[data-section-kicker]').textContent =
      view === 'overview' ? 'Operational readout' : 'Private service';
    if (view === 'shares' || view === 'pairing') void refresh();
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';
    const submit = loginForm.querySelector('[type="submit"]');
    const accessKey = loginForm.elements.accessKey.value;
    loginForm.elements.accessKey.value = '';
    const generation = beginRequest();
    const operation = ++loginOperation;
    submit.disabled = true;
    try {
      await api('/api/owner/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey }),
      });
      if (!isCurrent(generation)) return;
      await establishSession();
    } catch (error) {
      if (!isCurrent(generation)) return;
      loginError.textContent = error.message;
      loginForm.elements.accessKey.focus();
    } finally {
      if (operation === loginOperation) submit.disabled = false;
    }
  });

  refreshButton.addEventListener('click', () => void refresh({ includeLists: true }));
  root.querySelector('[data-logout]').addEventListener('click', async () => {
    if (signingOut) return;
    const generation = beginRequest();
    dashboardError.textContent = '';
    setSigningOut(true);
    setBusy(true, 'Signing out…', generation);
    try {
      await api('/api/owner/session', { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } });
      showLogin();
    } catch (error) {
      if (error.status === 401) return showLogin('Your owner session expired. Sign in again to continue.');
      dashboardError.textContent = `${error.message} Sign out was not completed. Try again.`;
      refreshedAt.textContent = 'Sign out failed. Try again.';
    } finally {
      setBusy(false, undefined, generation);
      setSigningOut(false);
    }
  });
  for (const trigger of root.querySelectorAll('[data-view-trigger], [data-open-view]'))
    trigger.addEventListener('click', () =>
      activateView(trigger.dataset.viewTrigger || trigger.dataset.openView),
    );
  for (const filter of root.querySelectorAll('[data-share-filter]')) {
    filter.addEventListener('click', () => {
      if (signingOut) return;
      activeFilter = filter.dataset.shareFilter;
      for (const option of root.querySelectorAll('[data-share-filter]')) {
        const selected = option === filter;
        option.classList.toggle('is-selected', selected);
        option.setAttribute('aria-pressed', String(selected));
      }
      void refresh({ includeLists: true });
    });
  }
  loadMore.addEventListener('click', () => void loadMoreShares());
  root.querySelector('[data-close-detail]').addEventListener('click', closeDetail);
  detailDialog.addEventListener('close', () => returnFocus?.focus());
  revokeForm.addEventListener('submit', async (event) => {
    if (revocationPending) {
      event.preventDefault();
      return;
    }
    if (event.submitter?.value !== 'confirm') return;
    event.preventDefault();
    if (!selectedShare) return;
    const generation = beginRequest();
    const operation = ++revokeOperation;
    setRevocationPending(true);
    root.querySelector('[data-revoke-error]').textContent = '';
    try {
      await api(`/api/owner/shares/${encodeURIComponent(selectedShare.id)}/revoke`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      if (!isCurrent(generation)) return;
      setRevocationPending(false);
      closeDialog(revokeDialog);
      selectedShare = undefined;
      await refresh({ includeLists: true });
    } catch (error) {
      if (!isCurrent(generation)) return;
      if (error.status === 401) {
        closeDialog(revokeDialog);
        return showLogin('Your owner session expired. Sign in again to continue.');
      }
      root.querySelector('[data-revoke-error]').textContent = error.message;
    } finally {
      if (operation === revokeOperation) setRevocationPending(false);
    }
  });
  revokeDialog.addEventListener('cancel', (event) => {
    if (revocationPending) event.preventDefault();
  });

  void establishSession();
  return { showLogin, refresh };
}

mountOwnerConsole();
