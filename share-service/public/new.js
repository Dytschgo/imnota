const createButton = document.querySelector('#create-code');
const copyButton = document.querySelector('#copy-code');
const result = document.querySelector('#result');
const code = document.querySelector('#upload-code');
const expiry = document.querySelector('#expiry');
const error = document.querySelector('#error');

createButton.addEventListener('click', async () => {
  createButton.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('/api/pairing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? 'Could not create an upload code.');
    code.value = payload.uploadToken;
    expiry.textContent = `Expires ${new Date(payload.expiresAt).toLocaleString()}.`;
    result.hidden = false;
    code.focus();
    code.select();
  } catch (caught) {
    error.textContent = caught.message;
    createButton.disabled = false;
  }
});

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(code.value);
    copyButton.textContent = 'Copied';
  } catch {
    code.focus();
    code.select();
    error.textContent = 'Automatic copy was unavailable. Copy the selected code manually.';
  }
});
