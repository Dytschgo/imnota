const createButton = document.querySelector('#create-code');
const copyButton = document.querySelector('#copy-code');
const result = document.querySelector('#result');
const code = document.querySelector('#upload-code');
const expiry = document.querySelector('#expiry');
const error = document.querySelector('#error');
const status = document.querySelector('#pairing-status');
const connection = document.querySelector('#connection-state');
const createStep = document.querySelector('#step-create');
const pasteStep = document.querySelector('#step-paste');
let expiresAt = 0;
let timer;

function updateExpiry() {
  const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  if (remaining > 0) {
    expiry.textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} remaining`;
    return true;
  }
  clearInterval(timer);
  code.value = '';
  result.hidden = true;
  copyButton.disabled = true;
  createButton.disabled = false;
  createButton.hidden = false;
  createButton.textContent = 'Create a new code';
  connection.textContent = 'Code expired';
  connection.dataset.state = 'expired';
  status.textContent = 'This code has expired. Create a new code to continue in Imnota.';
  createStep.setAttribute('aria-current', 'step');
  pasteStep.removeAttribute('aria-current');
  return false;
}

createButton.addEventListener('click', async () => {
  createButton.disabled = true;
  createButton.textContent = 'Creating code…';
  error.textContent = '';
  status.textContent = 'Creating a private, one-time upload code.';
  try {
    const response = await fetch('/api/pairing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? 'Could not create an upload code.');
    expiresAt = Date.parse(payload.expiresAt);
    if (!/^[A-Za-z0-9_-]{43}$/.test(payload.uploadToken) || !Number.isFinite(expiresAt)) {
      throw new Error('The service returned an invalid code. Please try again.');
    }
    code.value = payload.uploadToken;
    result.hidden = false;
    createButton.hidden = true;
    copyButton.disabled = false;
    copyButton.textContent = 'Copy code';
    connection.textContent = 'Ready to copy';
    connection.dataset.state = 'ready';
    status.textContent = 'Your code is ready. Copy it, then return to Imnota.';
    createStep.removeAttribute('aria-current');
    pasteStep.setAttribute('aria-current', 'step');
    clearInterval(timer);
    if (updateExpiry()) {
      timer = setInterval(updateExpiry, 1000);
      code.focus();
      code.select();
    }
  } catch (caught) {
    error.textContent =
      caught.name === 'TimeoutError'
        ? 'The connection timed out. Check your connection and try again.'
        : caught.message || 'Could not connect. Check your connection and try again.';
    status.textContent = '';
    createButton.disabled = false;
    createButton.textContent = 'Try creating a code again';
  }
});

copyButton.addEventListener('click', async () => {
  if (!updateExpiry()) return;
  error.textContent = '';
  try {
    await navigator.clipboard.writeText(code.value);
    if (!updateExpiry()) return;
    copyButton.textContent = 'Copied';
    connection.textContent = 'Continue in Imnota';
    status.textContent = 'Code copied. Paste it into the sharing dialog in Imnota.';
  } catch {
    if (!updateExpiry()) return;
    code.focus();
    code.select();
    error.textContent = 'Automatic copy was unavailable. Copy the selected code manually.';
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && expiresAt) updateExpiry();
});
