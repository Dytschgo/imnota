// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { QuickCaptureDragFiles } from './quick-capture-drag-files.js';

const fixtures: string[] = [];
afterEach(async () => {
  for (const directory of fixtures.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-quick-drag-test-')));
  fixtures.push(directory);
  return directory;
}

it('keeps immutable files across versions and retires only marked, old native-drag directories', async () => {
  const directory = await fixture(),
    root = path.join(directory, 'handoffs');
  const store = new QuickCaptureDragFiles(root);
  const first = await store.prepare(Buffer.from('first PNG'));
  const second = await store.prepare(Buffer.from('edited PNG'));
  expect(first).not.toBe(second);
  expect(await fs.readFile(first, 'utf8')).toBe('first PNG');
  const foreign = path.join(root, 'capture-foreign');
  await fs.mkdir(foreign);
  await fs.writeFile(path.join(foreign, 'Capture.png'), 'foreign bytes');
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await fs.utimes(path.dirname(first), old, old);
  await fs.utimes(foreign, old, old);
  const afterRestart = new QuickCaptureDragFiles(root);
  await afterRestart.prepare(Buffer.from('new PNG'));
  await expect(fs.stat(first)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(second, 'utf8')).toBe('edited PNG');
  expect(await fs.readFile(path.join(foreign, 'Capture.png'), 'utf8')).toBe('foreign bytes');
});

it('refuses a linked handoff root and leaves the link target untouched', async () => {
  const directory = await fixture();
  const outside = path.join(directory, 'outside'),
    link = path.join(directory, 'handoffs');
  await fs.mkdir(outside);
  await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(new QuickCaptureDragFiles(link).prepare(Buffer.from('PNG'))).rejects.toThrow(/link/i);
  expect(await fs.readdir(outside)).toEqual([]);
});
