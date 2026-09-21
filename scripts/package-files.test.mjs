import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

test('the packaged application includes the tray icon', async () => {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.ok(manifest.build.files.includes('build/icon.png'));
});
