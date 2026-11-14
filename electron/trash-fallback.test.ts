// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { trashWithLocalRecovery } from './trash-fallback.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-trash-fallback-')));
  directories.push(root);
  const source = path.join(root, 'source.png');
  const backup = path.join(root, 'image.bin');
  const bytes = Buffer.from('image-bytes');
  await fs.writeFile(source, bytes);
  await fs.writeFile(backup, bytes);
  return {
    root,
    source,
    backup,
    bytes,
    expected: {
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

it('leaves normal system trash behavior unchanged without requiring the local fallback', async () => {
  const f = await fixture();
  await fs.unlink(f.backup);
  const unlink = vi.fn();
  expect(await trashWithLocalRecovery(f.source, f.backup, f.expected, fs.unlink, unlink)).toBe(false);
  expect(unlink).not.toHaveBeenCalled();
});

it.each([
  'source-edit',
  'source-replaced',
  'backup-corrupt',
  'backup-missing',
  'backup-hardlink',
  'source-directory',
])('refuses local removal after %s and preserves all remaining files', async (change) => {
  const f = await fixture();
  const unlink = vi.fn((target: string) => fs.unlink(target));
  const trash = async () => {
    if (change === 'source-edit') await fs.writeFile(f.source, 'edited-data');
    if (change === 'source-replaced' || change === 'source-directory') {
      await fs.rename(f.source, path.join(f.root, 'original.png'));
      if (change === 'source-replaced') await fs.writeFile(f.source, f.bytes);
      else await fs.mkdir(f.source);
    }
    if (change === 'backup-corrupt') await fs.writeFile(f.backup, 'edited-data');
    if (change === 'backup-missing') await fs.unlink(f.backup);
    if (change === 'backup-hardlink') await fs.link(f.backup, path.join(f.root, 'other-backup.bin'));
    throw new Error('No system trash');
  };
  await expect(trashWithLocalRecovery(f.source, f.backup, f.expected, trash, unlink)).rejects.toThrow(
    'local recovery could not complete',
  );
  expect(unlink).not.toHaveBeenCalled();
  if (change === 'source-directory') expect((await fs.stat(f.source)).isDirectory()).toBe(true);
  else
    expect(await fs.readFile(f.source)).toEqual(
      change === 'source-edit' ? Buffer.from('edited-data') : f.bytes,
    );
});

it('accepts a rejected OS operation that already removed the source only with a valid recovery copy', async () => {
  const f = await fixture();
  const unlink = vi.fn();
  const trash = async (target: string) => {
    await fs.unlink(target);
    throw new Error('Unconfirmed OS result');
  };
  expect(await trashWithLocalRecovery(f.source, f.backup, f.expected, trash, unlink)).toBe(true);
  expect(await fs.readFile(f.backup)).toEqual(f.bytes);
  expect(unlink).not.toHaveBeenCalled();
});

it.each(['source', 'backup'] as const)(
  'refuses a linked %s and preserves the link target',
  async (selected) => {
    const f = await fixture();
    const foreign = path.join(f.root, 'foreign');
    await fs.mkdir(foreign);
    const other = path.join(foreign, 'other.png');
    await fs.writeFile(other, f.bytes);
    const unlink = vi.fn((target: string) => fs.unlink(target));
    const trash = async () => {
      await fs.rename(f[selected], path.join(f.root, 'preserved.bin'));
      await fs.symlink(
        process.platform === 'win32' ? foreign : other,
        f[selected],
        process.platform === 'win32' ? 'junction' : 'file',
      );
      throw new Error('No system trash');
    };
    await expect(trashWithLocalRecovery(f.source, f.backup, f.expected, trash, unlink)).rejects.toThrow(
      'local recovery could not complete',
    );
    expect(unlink).not.toHaveBeenCalled();
    expect(await fs.readFile(other)).toEqual(f.bytes);
    expect((await fs.lstat(f[selected])).isSymbolicLink()).toBe(true);
  },
);

it.skipIf(process.platform === 'win32').each(['source', 'backup'] as const)(
  'refuses a native FIFO substituted for %s without blocking',
  async (selected) => {
    const f = await fixture();
    const unlink = vi.fn((target: string) => fs.unlink(target));
    const trash = async () => {
      await fs.rename(f[selected], path.join(f.root, 'preserved.bin'));
      await promisify(execFile)('mkfifo', [f[selected]]);
      throw new Error('No system trash');
    };
    await expect(trashWithLocalRecovery(f.source, f.backup, f.expected, trash, unlink)).rejects.toThrow(
      'local recovery could not complete',
    );
    expect(unlink).not.toHaveBeenCalled();
    expect((await fs.lstat(f[selected])).isFIFO()).toBe(true);
    expect(await fs.readFile(path.join(f.root, 'preserved.bin'))).toEqual(f.bytes);
  },
  3_000,
);

it('reports a failed local unlink while retaining the source and recovery copy', async () => {
  const f = await fixture();
  await expect(
    trashWithLocalRecovery(
      f.source,
      f.backup,
      f.expected,
      async () => {
        throw new Error('No system trash');
      },
      async () => {
        throw new Error('Local unlink denied');
      },
    ),
  ).rejects.toThrow('Local unlink denied');
  expect(await fs.readFile(f.source)).toEqual(f.bytes);
  expect(await fs.readFile(f.backup)).toEqual(f.bytes);
});
