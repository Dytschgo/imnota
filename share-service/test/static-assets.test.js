import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStaticAssetVersioner } from '../src/static-assets.js';

test('changed asset bytes invalidate the URL without rewriting shared body content', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'imnota-static-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ['share.css', 'new.js', 'owner.css', 'owner.js', 'share-copy.js'])
    fs.writeFileSync(path.join(directory, name), `old ${name}`);
  const body = '<body><a href="/static/share.css">User Markdown link</a></body>';
  const html = '<head><link href="/static/share.css"><script src="/static/new.js"></script></head>' + body;
  const previous = createStaticAssetVersioner(directory)(html);
  fs.writeFileSync(path.join(directory, 'share.css'), 'new CSS');
  const current = createStaticAssetVersioner(directory)(html);
  const cssUrl = (page) => page.match(/href="([^"]+)"/u)[1];
  assert.notEqual(cssUrl(previous), cssUrl(current));
  const cache = new Map([
    [cssUrl(previous), 'old CSS'],
    ['/static/share.css', 'legacy CSS'],
  ]);
  assert.equal(cache.has(cssUrl(current)), false);
  assert.equal(previous.match(/src="([^"]+)"/u)[1], current.match(/src="([^"]+)"/u)[1]);
  assert.ok(current.endsWith(body));
});
