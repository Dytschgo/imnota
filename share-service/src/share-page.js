import { escapeHtml } from './security.js';

const policy =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'self'";

function copyControls(hasImage, label) {
  return `<div class="copy-split"><button class="button copy-primary" type="button" data-copy-bundle>Copy Bundle</button><details class="copy-options"><summary class="button copy-toggle" aria-label="Copy options for ${escapeHtml(label)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary><div class="copy-menu"><button type="button" data-copy-markdown>Copy Markdown</button>${hasImage ? '<button type="button" data-copy-png>Copy PNG</button>' : ''}</div></details></div>`;
}

export function sharePage(record, markdownHtml, assets, publicToken, publicOrigin, bundles = []) {
  const base = `/s/${publicToken}`;
  const items = bundles.length
    ? bundles
    : assets.length
      ? assets.map((asset, index) => ({ number: index + 1, imageFilename: asset.filename }))
      : [{ number: 1 }];
  const structured = bundles.length > 0;
  const markdownPath = (item) =>
    structured ? `${base}/bundles/${item.number}/markdown` : `${base}/markdown`;
  const imagePath = (item) =>
    item.imageFilename ? `${base}/assets/${encodeURIComponent(item.imageFilename)}` : '';
  const first = items[0];
  const sender = record.sender_name
    ? `${escapeHtml(record.sender_name)} shared this prompt bundle with you`
    : 'A prompt bundle, shared with you';
  const archive = record.has_archive
    ? `<a class="button secondary" href="${base}/archive.zip">Download ZIP</a>`
    : '';
  const selector =
    items.length > 1
      ? `<label class="bundle-picker">Bundle<select data-bundle-picker>${items.map((item) => `<option value="${item.number}">Bundle ${item.number}</option>`).join('')}</select></label>`
      : '';
  const cards = items
    .map((item) => {
      const asset = assets.find((candidate) => candidate.filename === item.imageFilename);
      return `<section class="bundle-preview" data-copy-scope data-bundle-number="${item.number}" data-markdown-url="${markdownPath(item)}" data-asset-url="${imagePath(item)}"><div class="bundle-heading"><h2>Bundle ${item.number}</h2>${asset ? `<span>${asset.width} × ${asset.height}</span>` : '<span>Text bundle</span>'}</div>${asset ? `<figure data-share-image data-asset-url="${imagePath(item)}"><a href="${imagePath(item)}" download aria-label="Download PNG for Bundle ${item.number}"><img src="${imagePath(item)}" alt="Annotated evidence for Bundle ${item.number}" width="${asset.width}" height="${asset.height}" loading="lazy"></a></figure>` : '<p class="text-bundle-note">This bundle contains Markdown only.</p>'}<div class="bundle-actions">${copyControls(Boolean(asset), `Bundle ${item.number}`)}${asset ? `<a class="quiet-link" href="${imagePath(item)}" download>Download PNG</a>` : ''}</div></section>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(record.title)} · Imnota</title><link rel="icon" href="/static/imnota-logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/share.css"><script type="module" src="/static/share-copy.js"></script></head><body><a class="skip-link" href="#main">Skip to bundle</a><header class="service-header"><a class="brand" href="/" aria-label="Imnota sharing home"><img class="brand-mark" src="/static/imnota-logo.svg" width="32" height="32" alt="" />imnota<span class="brand-context">/ shared bundle</span></a><a class="quiet-link" href="/">About sharing</a></header><main id="main" class="shared-bundle" data-share-copy-root><header class="share-heading"><p class="sender">${sender}</p><h1>${escapeHtml(record.title)}</h1><p class="expiry">Available until <time datetime="${new Date(record.expires_at).toISOString()}">${new Date(record.expires_at).toLocaleString('en-GB', { timeZone: 'UTC', timeZoneName: 'short' })}</time></p><p class="bundle-summary">${items.length} ${items.length === 1 ? 'bundle' : 'bundles'} · ${assets.length} ${assets.length === 1 ? 'image' : 'images'} · Markdown included</p><p class="bundle-instructions">Copy a bundle, then paste it into your coding agent. Use copy options for Markdown or PNG separately.</p></header><div class="share-toolbar" data-copy-scope data-top-copy data-markdown-url="${markdownPath(first)}" data-asset-url="${imagePath(first)}">${selector}${copyControls(
    items.some((item) => Boolean(item.imageFilename)),
    'selected bundle',
  )}${archive}</div><p class="copy-status" role="status" aria-live="polite" data-copy-status></p><div class="bundle-list">${cards}</div><details class="markdown-preview"><summary>Read Markdown</summary><article>${markdownHtml}</article><a class="quiet-link" href="${base}/markdown" download>Download Markdown</a></details><footer class="share-footer"><span>Shared with Imnota</span><details class="copy-help"><summary aria-label="Help with copying">Copying help</summary><p>Paste into your app after copying. If only the text or image appears, copy each separately from the dropdown.${!structured && items.length > 1 ? ' This older share includes all Markdown with each image.' : ''}</p></details><span>${escapeHtml(new URL(publicOrigin).host)}</span></footer></main></body></html>`;
}
