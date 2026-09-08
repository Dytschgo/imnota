const loginPanel = document.querySelector('[data-login]');
const dashboard = document.querySelector('[data-dashboard]');
const loginForm = document.querySelector('[data-login-form]');
const loginError = document.querySelector('[data-login-error]');
const dashboardError = document.querySelector('[data-dashboard-error]');
const shareList = document.querySelector('[data-share-list]');
const pairingList = document.querySelector('[data-pairing-list]');
const sharesEmpty = document.querySelector('[data-shares-empty]');
const pairingsEmpty = document.querySelector('[data-pairings-empty]');
const loadMore = document.querySelector('[data-load-more]');
const detailDialog = document.querySelector('[data-detail-dialog]');
const revokeDialog = document.querySelector('[data-revoke-dialog]');
const revokeForm = document.querySelector('[data-revoke-form]');
let csrfToken;
let nextCursor;
let requestGeneration = 0;
let overview;
let selectedShare;
let returnFocus;
let activeFilter = 'all';

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
  const element = document.createElement(name);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showLogin(message = '') {
  requestGeneration += 1;
  csrfToken = undefined;
  overview = undefined;
  nextCursor = undefined;
  shareList.replaceChildren();
  pairingList.replaceChildren();
  dashboard.hidden = true;
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
  overview = value;
  const status = document.querySelector('[data-overview-status]');
  status.replaceChildren(
    el('div', 'status-rail'),
    el('div', 'service-state', 'Metadata readout available'),
    el(
      'p',
      'service-copy',
      `Database query completed ${date(value.checkedAt)}. Storage values are service aggregates.`,
    ),
  );
  renderReadout(document.querySelector('[data-share-pulse]'), [
    ['Active', number(value.shares.active), 'Available shared links'],
    ['Expiring', number(value.shares.expiring), 'Within the next 24 hours'],
    [
      'Expired / revoked',
      number(value.shares.expired + value.shares.revoked),
      'Lifecycle records retained by policy',
    ],
  ]);
  renderReadout(document.querySelector('[data-storage-pulse]'), [
    [
      'Filesystem',
      bytes(value.storage.filesystemBytes),
      `of ${bytes(value.storage.capacityBytes)} configured capacity`,
    ],
    ['Recorded payload', bytes(value.storage.recordedBytes), 'Committed share artifacts'],
    ['Reserved', bytes(value.storage.reservedBytes), 'Staged uploads not yet committed'],
  ]);
  renderReadout(document.querySelector('[data-pairing-pulse]'), [
    ['Waiting', number(value.pairing.waiting), 'Unconsumed one-time pairings'],
    ['Consumed', number(value.pairing.consumed), 'Codes already used once'],
    ['Expired', number(value.pairing.expired), 'Unavailable pairing records'],
  ]);
  document.querySelector('[data-refreshed-at]').textContent = `Updated ${date(value.checkedAt)}`;
  renderStorage(value);
}

function renderStorage(value) {
  const target = document.querySelector('[data-storage-detail]');
  const accounted = value.storage.recordedBytes + value.storage.metadataBytes + value.storage.reservedBytes;
  const used = Math.min(100, (value.storage.filesystemBytes / value.storage.capacityBytes) * 100);
  const details = [
    ['Filesystem total', bytes(value.storage.filesystemBytes), 'Actual files under managed service storage.'],
    ['Recorded payload', bytes(value.storage.recordedBytes), 'Committed prompt-bundle artifact bytes.'],
    ['Metadata', bytes(value.storage.metadataBytes), 'Stored service metadata bytes.'],
    ['Reserved', bytes(value.storage.reservedBytes), 'Upload capacity currently reserved.'],
    ['Accounted subtotal', bytes(accounted), 'Payload, metadata, and reservations combined.'],
  ];
  const usage = el('section', 'storage-panel');
  usage.append(el('p', 'eyebrow', 'Capacity'), el('h3', '', 'Managed storage'));
  const meter = el('div', 'storage-meter');
  meter.setAttribute('role', 'progressbar');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', String(value.storage.capacityBytes));
  meter.setAttribute('aria-valuenow', String(value.storage.filesystemBytes));
  meter.setAttribute('aria-label', 'Managed storage used');
  const fill = el('span');
  fill.style.width = `${used}%`;
  meter.append(fill);
  usage.append(
    meter,
    el(
      'p',
      'capacity-copy',
      `${bytes(value.storage.filesystemBytes)} of ${bytes(value.storage.capacityBytes)} configured capacity`,
    ),
  );
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
  const row = document.createElement('tr');
  const open = el('button', 'table-link', share.reference);
  open.type = 'button';
  open.addEventListener('click', (event) => openShareDetail(share, event.currentTarget));
  row.append(
    rowCell(open),
    rowCell(badge(share.status, share.expiresSoon)),
    rowCell(document.createTextNode(date(share.createdAt)), 'numeric-cell'),
    rowCell(document.createTextNode(date(share.expiresAt)), 'numeric-cell'),
    rowCell(document.createTextNode(bytes(share.storedBytes)), 'numeric-cell'),
    rowCell(document.createTextNode(number(share.artifactCount)), 'numeric-cell'),
    rowCell(
      document.createTextNode(
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
  document.querySelector('[data-detail-title]').textContent = share.reference;
  const details = document.querySelector('[data-share-detail]');
  const list = el('dl', 'detail-list');
  list.append(
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
  const actions = document.querySelector('[data-detail-actions]');
  actions.replaceChildren();
  if (share.status === 'active') {
    const revoke = el('button', 'danger-button', 'Revoke share');
    revoke.type = 'button';
    revoke.addEventListener('click', () => {
      detailDialog.close();
      revokeDialog.showModal();
    });
    actions.append(revoke);
  }
  detailDialog.showModal();
}
function closeDetail() {
  detailDialog.close();
  returnFocus?.focus();
}
async function loadOverview() {
  renderOverview(await api('/api/owner/overview'));
}
async function loadPairings() {
  const body = await api('/api/owner/pairings');
  pairingList.replaceChildren(...body.pairings.map(renderPairing));
  pairingsEmpty.hidden = body.pairings.length > 0;
}
function renderPairing(pairing) {
  const row = document.createElement('tr');
  row.append(
    rowCell(document.createTextNode(pairing.reference)),
    rowCell(badge(pairing.status)),
    rowCell(document.createTextNode(date(pairing.createdAt)), 'numeric-cell'),
    rowCell(document.createTextNode(date(pairing.expiresAt)), 'numeric-cell'),
    rowCell(document.createTextNode(pairing.usedAt ? date(pairing.usedAt) : 'Not consumed'), 'numeric-cell'),
  );
  return row;
}
async function loadShares(append = false) {
  const generation = ++requestGeneration;
  let target = `/api/owner/shares?status=${encodeURIComponent(activeFilter)}&limit=50`;
  if (append && nextCursor) target += `&cursor=${encodeURIComponent(nextCursor)}`;
  const body = await api(target);
  if (generation !== requestGeneration) return;
  if (!append) shareList.replaceChildren();
  shareList.append(...body.shares.map(renderShare));
  sharesEmpty.hidden = shareList.rows.length > 0;
  nextCursor = body.nextCursor;
  loadMore.hidden = !nextCursor;
}
async function refresh({ includeLists = false } = {}) {
  dashboardError.textContent = '';
  try {
    await loadOverview();
    if (includeLists || !document.querySelector('[data-view="shares"]').hidden) await loadShares(false);
    if (includeLists || !document.querySelector('[data-view="pairing"]').hidden) await loadPairings();
  } catch (error) {
    if (error.status === 401) return showLogin('Your owner session expired. Sign in again to continue.');
    dashboardError.textContent = error.message;
  }
}
function activateView(view) {
  for (const element of document.querySelectorAll('[data-view]')) {
    const selected = element.dataset.view === view;
    element.hidden = !selected;
    element.classList.toggle('is-active', selected);
  }
  for (const trigger of document.querySelectorAll('[data-view-trigger]')) {
    const selected = trigger.dataset.viewTrigger === view;
    trigger.classList.toggle('is-active', selected);
    if (selected) trigger.setAttribute('aria-current', 'page');
    else trigger.removeAttribute('aria-current');
  }
  document.querySelector('[data-section-title]').textContent = view[0].toUpperCase() + view.slice(1);
  document.querySelector('[data-section-kicker]').textContent =
    view === 'overview' ? 'Operational readout' : 'Private service';
  if (view === 'shares' || view === 'pairing') void refresh();
}
async function bootstrap() {
  try {
    const session = await api('/api/owner/session');
    csrfToken = session.csrfToken;
    loginPanel.hidden = true;
    dashboard.hidden = false;
    await refresh({ includeLists: true });
  } catch (error) {
    if (error.status === 401) return showLogin();
    return showLogin(error.message);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const submit = loginForm.querySelector('[type="submit"]');
  const accessKey = loginForm.elements.accessKey.value;
  loginForm.elements.accessKey.value = '';
  submit.disabled = true;
  try {
    await api('/api/owner/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey }),
    });
    await bootstrap();
  } catch (error) {
    loginError.textContent = error.message;
    loginForm.elements.accessKey.focus();
  } finally {
    submit.disabled = false;
  }
});
document.querySelector('[data-refresh]').addEventListener('click', () => refresh({ includeLists: true }));
document.querySelector('[data-logout]').addEventListener('click', async () => {
  try {
    await api('/api/owner/session', { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } });
  } finally {
    showLogin();
  }
});
for (const trigger of document.querySelectorAll('[data-view-trigger], [data-open-view]'))
  trigger.addEventListener('click', () =>
    activateView(trigger.dataset.viewTrigger || trigger.dataset.openView),
  );
for (const filter of document.querySelectorAll('[data-share-filter]'))
  filter.addEventListener('click', () => {
    activeFilter = filter.dataset.shareFilter;
    for (const option of document.querySelectorAll('[data-share-filter]')) {
      const selected = option === filter;
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    }
    void refresh();
  });
loadMore.addEventListener('click', () => {
  loadMore.disabled = true;
  loadShares(true)
    .catch((error) => {
      if (error.status === 401) showLogin('Your owner session expired. Sign in again to continue.');
      else dashboardError.textContent = error.message;
    })
    .finally(() => {
      loadMore.disabled = false;
    });
});
document.querySelector('[data-close-detail]').addEventListener('click', closeDetail);
detailDialog.addEventListener('close', () => returnFocus?.focus());
revokeForm.addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'confirm') return;
  event.preventDefault();
  const confirm = event.submitter;
  confirm.disabled = true;
  document.querySelector('[data-revoke-error]').textContent = '';
  try {
    await api(`/api/owner/shares/${encodeURIComponent(selectedShare.id)}/revoke`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
    });
    revokeDialog.close();
    await refresh({ includeLists: true });
  } catch (error) {
    if (error.status === 401) {
      revokeDialog.close();
      showLogin('Your owner session expired. Sign in again to continue.');
    } else document.querySelector('[data-revoke-error]').textContent = error.message;
  } finally {
    confirm.disabled = false;
  }
});
bootstrap();
