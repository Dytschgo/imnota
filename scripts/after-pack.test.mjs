import { createPackage } from '@electron/asar';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyPackageContents } from './after-pack.mjs';

async function fixture(t, change = () => {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'imnota-package-contents-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    LICENSE: 'Synthetic application license',
    'build/icon.png': 'icon fixture',
    'scripts/update-macos.sh': 'updater fixture',
    'dist/index.html': '<script src="./assets/lazy.js"></script>',
    'dist/capture-overlay.html': 'capture fixture',
    'dist/THIRD-PARTY-NOTICES.txt': 'Synthetic notices',
    'dist/assets/lazy.js': 'export const lazy = true;',
    'dist/excalidraw/fonts/fixture.woff2': 'font fixture',
    'dist-electron/electron/main.js': 'main fixture',
    'node_modules/jszip/package.json': '{"name":"jszip","main":"lib/index.js"}',
    'node_modules/jszip/lib/index.js': 'runtime ZIP fixture',
    'node_modules/@koromix/koffi-win32-x64/koffi.node': 'native fixture',
    'package.json': '{"version":"0.4.0","dependencies":{"jszip":"3.10.2"}}',
  };
  // The expected frontend is independent of mutations to the packaged fixture.
  for (const [file, bytes] of Object.entries(files).filter(([file]) => file.startsWith('dist/'))) {
    const target = path.join(root, 'expected', file.slice(5));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  change(files);
  for (const [file, bytes] of Object.entries(files)) {
    const target = path.join(root, 'app', file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const archive = path.join(root, 'app.asar');
  await createPackage(path.join(root, 'app'), archive);
  return (platform = 'win32', architecture = 1) =>
    verifyPackageContents(archive, path.join(root, 'expected'), platform, architecture);
}

test('verifies a real archive with lazy assets, local fonts and native runtime files', async (t) => {
  const verify = await fixture(t);
  const report = await verify();
  assert.equal(report.rendererFilesVerified, 5);
  assert.ok(report.asarBytes > 0);
  assert.match(report.asarSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.runtimeDependencies, ['jszip']);
});

for (const [label, mutate, message] of [
  ['a dropped lazy chunk', (files) => delete files['dist/assets/lazy.js'], /Missing built renderer asset/],
  ['a changed font', (files) => { files['dist/excalidraw/fonts/fixture.woff2'] = 'different'; }, /Changed built renderer asset/],
  ['a redundant renderer tree', (files) => { files['node_modules/mermaid/index.js'] = 'duplicate'; }, /Redundant renderer package/],
  ['a dependency source map', (files) => { files['node_modules/jszip/lib/index.js.map'] = '{}'; }, /Dependency source maps/],
  ['an unused browser distribution', (files) => { files['node_modules/jszip/dist/jszip.js'] = 'browser bundle'; }, /Unused browser ZIP/],
  ['a missing runtime dependency', (files) => delete files['node_modules/jszip/package.json'], /Missing Node runtime dependency/],
  ['a missing native module', (files) => delete files['node_modules/@koromix/koffi-win32-x64/koffi.node'], /Missing Windows native/],
]) {
  test(`rejects ${label}`, async (t) => {
    const verify = await fixture(t, mutate);
    await assert.rejects(verify(), message);
  });
}
