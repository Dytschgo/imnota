import { escapeHtml } from './security.js';

const policy =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'self'";

const icons = {
  copy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  chevron:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  download:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 21h16"/></svg>',
};

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** A coarse, server-rendered countdown. The page is no-store, so it is current on every load. */
export function expiryLabel(expiresAt, now) {
  const remaining = Date.parse(expiresAt) - now;
  const hours = Math.floor(remaining / 3_600_000);
  if (hours < 1) return 'Expires in less than an hour';
  if (hours < 48) return `Expires in ${plural(hours, 'hour')}`;
  return `Expires in ${plural(Math.floor(hours / 24), 'day')}`;
}

function copyControls({ label, markdownPath, imagePath }) {
  const image = imagePath ? `<button type="button" data-copy-png>Copy image only</button>` : '';
  const imageDownload = imagePath ? `<a href="${imagePath}" download>Download PNG</a>` : '';
  return `<div class="copy-split"><button class="button copy-primary" type="button" data-copy-bundle>${icons.copy}<span data-copy-label>Copy ${escapeHtml(label)}</span></button><details class="copy-options"><summary class="button copy-toggle" aria-label="More copy and download options for ${escapeHtml(label)}">${icons.chevron}</summary><div class="copy-menu"><button type="button" data-copy-markdown>Copy Markdown only</button>${image}<hr><a href="${markdownPath}" download>Download Markdown</a>${imageDownload}</div></details></div>`;
}

function bundleCard(item, { total, structured, renderedMarkdown }) {
  const label = total > 1 ? `bundle ${item.number}` : 'bundle';
  const heading = total > 1 ? `Bundle ${item.number} <span>of ${total}</span>` : 'Prompt bundle';
  const facts = [
    item.asset ? `Image ${item.asset.width} × ${item.asset.height}` : 'Text only',
    'Markdown',
  ].join(' · ');
  const figure = item.asset
    ? `<figure class="bundle-image"><a href="${item.imagePath}" target="_blank" rel="noopener" aria-label="Open the full-size image for ${escapeHtml(label)} in a new tab"><img src="${item.imagePath}" alt="Annotated screenshot for ${escapeHtml(label)}" width="${item.asset.width}" height="${item.asset.height}" loading="${item.number === 1 ? 'eager' : 'lazy'}"></a><figcaption>Select the image to open it at full size.</figcaption></figure>`
    : '';
  const prompt = structured
    ? `<section class="bundle-prompt" aria-label="Prompt text for ${escapeHtml(label)}"><h3>Prompt text</h3><article tabindex="0">${renderedMarkdown}</article></section>`
    : '';
  return `<li class="bundle-card${item.asset ? '' : ' is-text-only'}${prompt ? '' : ' is-image-only'}" data-copy-scope data-bundle-number="${item.number}" data-copy-label="${escapeHtml(label)}" data-markdown-url="${item.markdownPath}" data-asset-url="${item.imagePath}"><header class="bundle-card-head"><div><h2>${heading}</h2><p>${facts}<span class="copied-badge" data-copied-badge hidden> · Copied</span></p></div>${copyControls({ label, markdownPath: item.markdownPath, imagePath: item.imagePath })}</header><div class="bundle-body">${figure}${prompt}</div></li>`;
}

/** markdownHtml and each bundle's markdownHtml must already be sanitized. */
export function sharePage(
  record,
  markdownHtml,
  assets,
  publicToken,
  publicOrigin,
  bundles = [],
  now = Date.now(),
) {
  const base = `/s/${publicToken}`;
  const structured = bundles.length > 0;
  const sources = structured
    ? bundles
    : assets.length
      ? assets.map((asset, index) => ({ number: index + 1, imageFilename: asset.filename }))
      : [{ number: 1, imageFilename: null }];
  const items = sources.map((item) => ({
    ...item,
    asset: assets.find((candidate) => candidate.filename === item.imageFilename),
    markdownPath: structured ? `${base}/bundles/${item.number}/markdown` : `${base}/markdown`,
    imagePath: item.imageFilename ? `${base}/assets/${encodeURIComponent(item.imageFilename)}` : '',
  }));
  const total = items.length;
  const imageCount = items.filter((item) => item.asset).length;
  const sender = record.sender_name
    ? `<span class="sender-avatar" aria-hidden="true">${escapeHtml(Array.from(record.sender_name.trim())[0]?.toUpperCase() ?? '')}</span><span><strong>${escapeHtml(record.sender_name)}</strong> shared ${total === 1 ? 'this prompt bundle' : 'these prompt bundles'} with you</span>`
    : `<span>${total === 1 ? 'A prompt bundle' : 'Prompt bundles'}, shared with you</span>`;
  const expiresAt = new Date(record.expires_at).toISOString();
  const absoluteExpiry = `${new Date(record.expires_at).toLocaleString('en-GB', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  })} UTC`;
  const downloads = `${record.has_archive ? `<a class="button secondary" href="${base}/archive.zip" download>${icons.download}Download all (ZIP)</a>` : ''}<a class="button secondary" href="${base}/markdown" download>${icons.download}Download Markdown</a>`;
  const steps =
    total > 1
      ? ['Copy a bundle', 'Paste it into your coding agent', 'Repeat for the next bundle, in order']
      : ['Copy the bundle', 'Paste it into your coding agent', 'Check the result'];
  const legacyPrompt = structured
    ? ''
    : `<section class="legacy-prompt"><h2>Prompt text</h2>${total > 1 ? '<p>This share was created by an older Imnota version, so every copy includes the complete prompt text below.</p>' : ''}<article tabindex="0">${markdownHtml}</article></section>`;
  const cards = items
    .map((item) => bundleCard(item, { total, structured, renderedMarkdown: item.markdownHtml ?? '' }))
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(record.title)} · Imnota</title><link rel="icon" href="/static/imnota-logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/share.css"><script type="module" src="/static/share-copy.js"></script></head><body class="share-body"><a class="skip-link" href="#bundles">Skip to the bundles</a><header class="service-header"><a class="brand" href="/" aria-label="Imnota sharing home"><img class="brand-mark" src="/static/imnota-logo.svg" width="32" height="32" alt="" />imnota<span class="brand-context">/ shared bundle</span></a><a class="quiet-link" href="/">About sharing</a></header><main id="main" class="shared-bundle" data-share-copy-root><header class="share-hero"><p class="sender">${sender}</p><h1>${escapeHtml(record.title)}</h1><ul class="share-facts" aria-label="About this share"><li>${plural(total, 'bundle')}</li><li>${plural(imageCount, 'image')}</li><li><time datetime="${expiresAt}" title="Available until ${escapeHtml(absoluteExpiry)}">${expiryLabel(expiresAt, now)}</time></li></ul><div class="share-downloads">${downloads}</div></header><ol class="share-steps" aria-label="How to use this share">${steps.map((step, index) => `<li><span aria-hidden="true">${index + 1}</span>${step}</li>`).join('')}</ol><noscript><p class="noscript-note">Copy buttons need JavaScript. You can still read the prompt text and use the downloads.</p></noscript>${legacyPrompt}<ol class="bundle-list" id="bundles">${cards}</ol><p class="copy-status" role="status" aria-live="polite" data-copy-status></p><footer class="share-footer"><p>Available until <time datetime="${expiresAt}">${escapeHtml(absoluteExpiry)}</time>. Anyone with this link can open it until then.</p><details class="copy-help"><summary>Paste didn’t include everything?</summary><p>Each app decides what it accepts from the clipboard. If only the text or only the image arrives, use <strong>Copy Markdown only</strong> and <strong>Copy image only</strong> from the arrow menu, or download the files.</p></details><span>Shared with Imnota · ${escapeHtml(new URL(publicOrigin).host)}</span></footer></main></body></html>`;
}
