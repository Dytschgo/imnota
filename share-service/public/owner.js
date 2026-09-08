const loginPanel = document.querySelector('[data-login]');
const dashboard = document.querySelector('[data-dashboard]');
const loginForm = document.querySelector('[data-login-form]');
const loginError = document.querySelector('[data-login-error]');
const dashboardError = document.querySelector('[data-dashboard-error]');
const shareList = document.querySelector('[data-share-list]');
const totals = document.querySelector('[data-totals]');
const filter = document.querySelector('[data-status-filter]');
const loadMore = document.querySelector('[data-load-more]');
let csrfToken;
let nextCursor;
let requestGeneration = 0;

async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...options });
  if (response.status === 204) return undefined;
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('The service returned an invalid response.');
  }
  if (!response.ok) {
    const message = body?.error?.message;
    throw Object.assign(new Error(typeof message === 'string' ? message : 'The request failed.'), {
      status: response.status,
    });
  }
  return body;
}

function showLogin() {
  requestGeneration += 1;
  csrfToken = undefined;
  nextCursor = undefined;
  shareList.replaceChildren();
  totals.replaceChildren();
  dashboard.hidden = true;
  loginPanel.hidden = false;
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

function date(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function renderTotals(value) {
  totals.replaceChildren();
  for (const [label, amount] of [
    ['Active', value.active],
    ['Expired', value.expired],
    ['Revoked', value.revoked],
    ['Page loads', value.usage.pageViews],
    ['PNG requests', value.usage.pngRequests],
    ['Stored', bytes(value.storedBytes)],
  ]) {
    const item = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = typeof amount === 'number' ? number(amount) : amount;
    const span = document.createElement('span');
    span.textContent = label;
    item.append(strong, span);
    totals.append(item);
  }
}

function usageText(usage) {
  const parts = [
    `${number(usage.pageViews)} page loads`,
    `${number(usage.markdownRequests)} Markdown requests`,
    `${number(usage.pngRequests)} PNG requests`,
    `${number(usage.zipRequests)} ZIP requests`,
  ];
  if (usage.lastAccessedAt) parts.push(`last request ${date(usage.lastAccessedAt)}`);
  return parts.join(' · ');
}

function renderShare(share) {
  const article = document.createElement('article');
  article.className = 'share-row';
  const body = document.createElement('div');
  const heading = document.createElement('h2');
  heading.textContent = share.title;
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = `#${share.id.slice(-6)} · created ${date(share.createdAt)} · expires ${date(share.expiresAt)}`;
  const usage = document.createElement('p');
  usage.className = 'usage';
  usage.textContent = usageText(share.usage);
  body.append(heading, meta, usage);
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  const status = document.createElement('span');
  status.className = `status status-${share.status}`;
  status.textContent = share.status;
  actions.append(status);
  if (share.status === 'active') {
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.className = 'danger';
    revoke.textContent = 'Revoke';
    revoke.addEventListener('click', async () => {
      if (!globalThis.confirm(`Revoke “${share.title}”? The shared link will stop working immediately.`))
        return;
      revoke.disabled = true;
      dashboardError.textContent = '';
      try {
        await api(`/api/owner/shares/${encodeURIComponent(share.id)}/revoke`, {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfToken },
        });
        await loadShares(false);
      } catch (error) {
        if (error.status === 401) return showLogin();
        dashboardError.textContent = error.message;
        revoke.disabled = false;
      }
    });
    actions.append(revoke);
  }
  article.append(body, actions);
  return article;
}

async function loadShares(append) {
  const generation = ++requestGeneration;
  dashboardError.textContent = '';
  let target = `/api/owner/shares?status=${encodeURIComponent(filter.value)}&limit=50`;
  if (append && nextCursor) target += `&cursor=${encodeURIComponent(nextCursor)}`;
  try {
    const body = await api(target);
    if (generation !== requestGeneration) return;
    if (!append) {
      shareList.replaceChildren();
      renderTotals(body.totals);
    }
    for (const share of body.shares) shareList.append(renderShare(share));
    if (!append && body.shares.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No shared links match this filter.';
      shareList.append(empty);
    }
    nextCursor = body.nextCursor;
    loadMore.hidden = !nextCursor;
  } catch (error) {
    if (generation !== requestGeneration) return;
    if (error.status === 401) return showLogin();
    dashboardError.textContent = error.message;
  }
}

async function bootstrap() {
  try {
    const session = await api('/api/owner/session');
    csrfToken = session.csrfToken;
    loginPanel.hidden = true;
    dashboard.hidden = false;
    await loadShares(false);
  } catch (error) {
    if (error.status === 401) return showLogin();
    showLogin();
    loginError.textContent = error.message;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const accessKey = loginForm.elements.accessKey.value;
  loginForm.elements.accessKey.value = '';
  try {
    await api('/api/owner/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey }),
    });
    await bootstrap();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

filter.addEventListener('change', () => loadShares(false));
document.querySelector('[data-refresh]').addEventListener('click', () => loadShares(false));
loadMore.addEventListener('click', () => loadShares(true));
document.querySelector('[data-logout]').addEventListener('click', async () => {
  try {
    await api('/api/owner/session', { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } });
  } finally {
    showLogin();
  }
});

bootstrap();
