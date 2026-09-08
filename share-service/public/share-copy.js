const MAX_MARKDOWN_BYTES = 1024 * 1024;
const MAX_PNG_BYTES = 10 * 1024 * 1024;
const ARTIFACT_TIMEOUT_MS = 15_000;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.png$/i;

export class ClipboardUnavailableError extends Error {
  constructor(message = 'Clipboard access is unavailable.') {
    super(message);
    this.name = 'ClipboardUnavailableError';
  }
}

function shareBasePath(locationObject = globalThis.location) {
  const current = new URL(locationObject.href);
  if (current.origin !== locationObject.origin || !/^\/s\/[A-Za-z0-9_-]{43}$/u.test(current.pathname)) {
    throw new Error('The current page is not a share page.');
  }
  return current.pathname;
}

function artifactUrl(path, kind, locationObject = globalThis.location) {
  const url = new URL(path, locationObject.href);
  const basePath = shareBasePath(locationObject);
  if (url.origin !== locationObject.origin || url.username || url.password || url.search || url.hash) {
    throw new Error('The requested artifact is not a same-origin share artifact.');
  }
  if (kind === 'markdown' && url.pathname !== `${basePath}/markdown`)
    throw new Error('The requested artifact is not this share’s Markdown.');
  if (kind === 'png') {
    const prefix = `${basePath}/assets/`;
    const encodedFilename = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
    let filename;
    try {
      filename = decodeURIComponent(encodedFilename);
    } catch {
      throw new Error('The requested artifact is not this share’s PNG.');
    }
    if (!encodedFilename || encodeURIComponent(filename) !== encodedFilename || !PNG_FILENAME.test(filename))
      throw new Error('The requested artifact is not this share’s PNG.');
  }
  return url.href;
}

function contentType(response) {
  return (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
}

function declaredLength(response, maximumBytes) {
  const header = response.headers.get('content-length');
  if (!header) return undefined;
  if (!/^\d+$/u.test(header)) throw new Error('The artifact has an invalid length.');
  const length = Number(header);
  if (!Number.isSafeInteger(length) || length > maximumBytes)
    throw new Error('The artifact is too large to copy.');
  return length;
}

async function boundedChunks(response, maximumBytes) {
  declaredLength(response, maximumBytes);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error('The artifact is too large to copy.');
    return [bytes];
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error('The artifact is too large to copy.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return chunks;
}

function hasPngSignature(chunks) {
  let offset = 0;
  for (const chunk of chunks) {
    for (const byte of chunk) {
      if (byte !== PNG_SIGNATURE[offset]) return false;
      offset += 1;
      if (offset === PNG_SIGNATURE.length) return true;
    }
  }
  return false;
}

async function fetchArtifact(
  path,
  kind,
  expectedType,
  blobType,
  maximumBytes,
  { fetchImpl = globalThis.fetch, locationObject, signal } = {},
) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetching shared artifacts is unavailable.');
  const response = await fetchImpl(artifactUrl(path, kind, locationObject), {
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
  if (!response.ok) throw new Error(`The artifact could not be loaded (${response.status}).`);
  if (response.redirected) throw new Error('The artifact redirect was blocked.');
  if (contentType(response) !== expectedType) throw new Error('The artifact has an unexpected file type.');
  const chunks = await boundedChunks(response, maximumBytes);
  if (expectedType === 'image/png' && !hasPngSignature(chunks))
    throw new Error('The image is not a valid PNG artifact.');
  return new Blob(chunks, { type: blobType });
}

function clipboardParts(markdownPath, pngPath, options) {
  const parts = {};
  if (markdownPath)
    parts['text/plain'] = fetchArtifact(
      markdownPath,
      'markdown',
      'text/markdown',
      'text/plain',
      MAX_MARKDOWN_BYTES,
      options,
    );
  if (pngPath)
    parts['image/png'] = fetchArtifact(pngPath, 'png', 'image/png', 'image/png', MAX_PNG_BYTES, options);
  return parts;
}

function clipboardScope() {
  if (typeof AbortController !== 'function') throw new ClipboardUnavailableError();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ARTIFACT_TIMEOUT_MS);
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    finish: () => clearTimeout(timeout),
  };
}

/**
 * Starts artifact fetches and invokes clipboard.write without awaiting first. ClipboardItem accepts
 * Promise<Blob> representations, which keeps Safari's click activation alive while bytes load.
 */
export function writeShareClipboard({ markdownPath, pngPath, clipboard, ClipboardItemCtor, ...options }) {
  const resolvedClipboard = clipboard ?? globalThis.navigator?.clipboard;
  const ResolvedClipboardItem = ClipboardItemCtor ?? globalThis.ClipboardItem;
  if (!resolvedClipboard?.write || !ResolvedClipboardItem) throw new ClipboardUnavailableError();
  const scope = clipboardScope();
  const parts = clipboardParts(markdownPath, pngPath, { ...options, signal: scope.signal });
  const representations = Object.values(parts);
  if (representations.length === 0) {
    scope.finish();
    throw new Error('There is no share artifact to copy.');
  }
  // Clipboard APIs may reject before inspecting representations. Handle those Promise rejections
  // while keeping the original rejecting Promises available to ClipboardItem.
  for (const representation of representations) representation.catch(() => scope.abort());
  let item;
  try {
    item = new ResolvedClipboardItem(parts);
  } catch (error) {
    scope.abort();
    scope.finish();
    throw error;
  }
  let write;
  try {
    write = resolvedClipboard.write([item]);
  } catch (error) {
    scope.abort();
    scope.finish();
    throw error;
  }
  // Some implementations resolve write after accepting the item rather than after resolving every
  // representation. Waiting here keeps the status honest and leaves the deadline active.
  const completed = Promise.resolve(write).then((value) => Promise.all(representations).then(() => value));
  return completed.then(
    (value) => {
      scope.finish();
      return value;
    },
    (error) => {
      scope.abort();
      scope.finish();
      throw error;
    },
  );
}

function messageFor(error, fallback) {
  if (error instanceof ClipboardUnavailableError) return `Clipboard access is unavailable. ${fallback}`;
  if (error?.name === 'NotAllowedError') return `Clipboard permission was denied. ${fallback}`;
  return `Couldn’t copy. ${fallback}`;
}

function boot(documentObject = globalThis.document) {
  const root = documentObject?.querySelector?.('[data-share-copy-root]');
  if (!root) return;
  const markdownPath = root.getAttribute('data-markdown-url');
  const status = root.querySelector('[data-copy-status]');
  const controls = root.querySelectorAll('[data-copy-markdown], [data-copy-png], [data-copy-png-markdown]');
  let copying = false;
  const setStatus = (message, error = false) => {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', error);
  };
  const run = (button, action, success, fallback) => {
    button.addEventListener('click', async () => {
      if (copying) return;
      copying = true;
      for (const control of controls) control.disabled = true;
      setStatus('Copying…');
      try {
        // action reaches clipboard.write before this handler awaits its result.
        await action();
        setStatus(success);
      } catch (error) {
        setStatus(messageFor(error, fallback), true);
      } finally {
        copying = false;
        for (const control of controls) control.disabled = false;
      }
    });
  };

  const copyMarkdown = root.querySelector('[data-copy-markdown]');
  if (copyMarkdown && markdownPath) {
    run(
      copyMarkdown,
      () => writeShareClipboard({ markdownPath }),
      'Markdown copied.',
      'Download Markdown instead.',
    );
  }
  for (const figure of root.querySelectorAll('[data-share-image]')) {
    const pngPath = figure.getAttribute('data-asset-url');
    if (!pngPath) continue;
    const copyPng = figure.querySelector('[data-copy-png]');
    if (copyPng) {
      run(copyPng, () => writeShareClipboard({ pngPath }), 'PNG copied.', 'Download PNG instead.');
    }
    const copyPngAndMarkdown = figure.querySelector('[data-copy-png-markdown]');
    if (copyPngAndMarkdown && markdownPath) {
      run(
        copyPngAndMarkdown,
        () => writeShareClipboard({ markdownPath, pngPath }),
        'PNG and Markdown copied.',
        'Download the PNG and Markdown instead.',
      );
    }
  }
}

if (typeof document !== 'undefined') boot();
