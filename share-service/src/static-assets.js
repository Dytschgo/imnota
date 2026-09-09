import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const assetNames = ['share.css', 'new.js', 'owner.css', 'owner.js', 'share-copy.js'];

export function createStaticAssetVersioner(directory) {
  const urls = new Map(
    assetNames.map((name) => {
      const digest = createHash('sha256')
        .update(fs.readFileSync(path.join(directory, name)))
        .digest('hex');
      return [`/static/${name}`, `/static/${name}?v=${digest}`];
    }),
  );
  return (html) => {
    // Only owned head resources are versioned; shared Markdown and body links stay untouched.
    const end = html.indexOf('</head>');
    if (end < 0) throw new Error('Service page is missing its head boundary.');
    return (
      html
        .slice(0, end)
        .replace(/(href|src)="(\/static\/[^"?]+)"/gu, (match, attribute, url) =>
          urls.has(url) ? `${attribute}="${urls.get(url)}"` : match,
        ) + html.slice(end)
    );
  };
}

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
export const versionStaticHead = createStaticAssetVersioner(publicDirectory);
