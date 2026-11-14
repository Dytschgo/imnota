// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { copyMacSecurityObserver } from '../../../electron/macos-security-observer.js';

it('copies exact observer bytes privately and preserves an occupied sibling', async () => {
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'imnota-observer-copy-'));
  try {
    const source = path.join(root, 'source');
    const target = path.join(root, 'target');
    await fs.mkdir(target);
    const bytes = Buffer.from('Synthetic observer bytes');
    await fs.writeFile(source, bytes);
    await copyMacSecurityObserver(source, target);
    const copied = path.join(target, 'imnota-security-observer');
    expect(await fs.readFile(copied)).toEqual(bytes);
    if (process.platform !== 'win32') expect((await fs.stat(copied)).mode & 0o777).toBe(0o700);
    await expect(copyMacSecurityObserver(source, target)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await fs.readFile(copied)).toEqual(bytes);
    const empty = path.join(root, 'empty');
    await fs.mkdir(empty);
    await copyMacSecurityObserver(path.join(root, 'missing'), empty);
    expect(await fs.readdir(empty)).toEqual([]);
    await expect(copyMacSecurityObserver(target, empty)).rejects.toThrow();
    if (process.platform !== 'win32') {
      const link = path.join(root, 'linked');
      await fs.symlink(source, link);
      await expect(copyMacSecurityObserver(link, empty)).rejects.toThrow();
    }
    expect(await fs.readdir(empty)).toEqual([]);
  } finally {
    expect(path.dirname(root)).toBe(temporaryRoot);
    expect(path.basename(root)).toMatch(/^imnota-observer-copy-/);
    await fs.rm(root, { recursive: true });
  }
});
