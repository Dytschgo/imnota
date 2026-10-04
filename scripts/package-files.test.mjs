import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

test('the packaged application includes the tray icon', async () => {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.ok(manifest.build.files.includes('build/icon.png'));
});

test('Windows packages the runnable MCP relay outside asar beside the installed executable', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(
    manifest.build.win.extraResources.some(
      (entry) => entry.from === 'scripts/imnota-mcp.mjs' && entry.to === 'imnota-mcp.mjs',
    ),
  );
  assert.match(await readFile(new URL('./imnota-mcp.mjs', import.meta.url), 'utf8'), /Imnota\.exe/);
});
