// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withCreatedFileCleanup } from './created-file-cleanup.js';
import { atomicWrite, CommittedWriteError } from './files.js';

let directory: string;
const originalError = new Error('Injected metadata save failure');
beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-owned-write-')));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

it.each(['native', 'forward-slash'])(
  'preserves a foreign replacement after successful rename (%s path)',
  async (style) => {
    const native = path.join(directory, 'created.png');
    const target = style === 'native' ? native : native.replaceAll('\\', '/');
    const foreign = path.join(directory, 'foreign.png');
    await fs.writeFile(foreign, 'FOREIGN USER IMAGE');
    const rename = fs.rename.bind(fs);
    await expect(
      withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
        await create(target, async (capture) => {
          await atomicWrite(target, 'OUR IMAGE', capture);
          // Deterministic hook after successful write/rename, before create returns
          // and the old cleanup helper would sample the destination-path identity.
          await rename(foreign, target);
        });
        throw originalError;
      }),
    ).rejects.toBe(originalError);
    expect(await fs.readFile(target, 'utf8')).toBe('FOREIGN USER IMAGE');
  },
);

it.each(['mtimeNs', 'ctimeNs'] as const)(
  'preserves a same-size edit whose %s differs only within the same millisecond',
  async (field) => {
    const target = path.join(directory, 'created.png');
    let edited = false;
    const milliseconds = 1_700_000_000_000n;
    // Controlled stat projection avoids depending on the host filesystem's timestamp
    // resolution or scheduler. Opens, writes, renames, edits and cleanup remain real.
    // Change just one timestamp to independently prove both precision checks.
    const projectTimes = <T extends { mtimeMs: number | bigint }>(stat: T): T => {
      if (typeof stat.mtimeMs === 'bigint')
        Object.assign(stat, {
          mtimeMs: milliseconds,
          mtimeNs: milliseconds * 1_000_000n + (edited && field === 'mtimeNs' ? 200n : 100n),
          ctimeNs: milliseconds * 1_000_000n + (edited && field === 'ctimeNs' ? 200n : 100n),
        });
      return stat;
    };
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => projectTimes(await lstat(...args)));
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      const stat = handle.stat.bind(handle);
      vi.spyOn(handle, 'stat').mockImplementation(async (...options) => projectTimes(await stat(...options)));
      return handle;
    });
    await expect(
      withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
        await create(target, (capture) => atomicWrite(target, 'OURS', capture));
        await fs.writeFile(target, 'EDIT');
        edited = true;
        const current = await fs.lstat(target, { bigint: true });
        expect(current.mtimeMs).toBe(milliseconds);
        expect(current[field]).toBe(milliseconds * 1_000_000n + 200n);
        throw originalError;
      }),
    ).rejects.toBe(originalError);
    expect(await fs.readFile(target, 'utf8')).toBe('EDIT');
  },
);

it('removes our unchanged file on metadata failure', async () => {
  const target = path.join(directory, 'created.png');
  await expect(
    withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
      await create(target, (capture) => atomicWrite(target, 'OURS', capture));
      throw originalError;
    }),
  ).rejects.toBe(originalError);
  await expect(fs.lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('keeps referenced files when project replacement committed', async () => {
  const target = path.join(directory, 'created.png');
  const projectFile = path.join(directory, 'project.json');
  const warning = new CommittedWriteError(projectFile, originalError);
  await expect(
    withCreatedFileCleanup(projectFile, async (create) => {
      await create(target, (capture) => atomicWrite(target, 'OURS', capture));
      await fs.writeFile(projectFile, JSON.stringify({ image: 'created.png' }));
      throw warning;
    }),
  ).rejects.toBe(warning);
  expect(await fs.readFile(target, 'utf8')).toBe('OURS');
});

it('preserves a foreign replacement between evidence capture and cleanup', async () => {
  const target = path.join(directory, 'created.png');
  const foreign = path.join(directory, 'foreign.png');
  await fs.writeFile(foreign, 'FOREIGN');
  await expect(
    withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
      await create(target, (capture) => atomicWrite(target, 'OURS', capture));
      await fs.rename(foreign, target);
      throw originalError;
    }),
  ).rejects.toBe(originalError);
  expect(await fs.readFile(target, 'utf8')).toBe('FOREIGN');
});

it('preserves a successful write without writer evidence', async () => {
  const target = path.join(directory, 'created.png');
  await expect(
    withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
      await create(target, () => fs.writeFile(target, 'UNPROVEN'));
      throw originalError;
    }),
  ).rejects.toBe(originalError);
  expect(await fs.readFile(target, 'utf8')).toBe('UNPROVEN');
});

it.each(['before-stat', 'witness-open', 'after-stat'])(
  'preserves a write when %s cannot provide evidence',
  async (stage) => {
    const target = path.join(directory, 'created.png');
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const temporary = String(args[0]).includes('.tmp-');
      if (temporary && args[1] === 'r' && stage === 'witness-open') throw new Error('EACCES');
      const handle = await open(...args);
      if (
        temporary &&
        ((args[1] === 'wx' && stage === 'before-stat') || (args[1] === 'r' && stage === 'after-stat'))
      )
        vi.spyOn(handle, 'stat').mockRejectedValue(new Error('EIO'));
      return handle;
    });
    await expect(
      withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
        await create(target, (capture) => atomicWrite(target, 'OURS', capture));
        throw originalError;
      }),
    ).rejects.toBe(originalError);
    expect(await fs.readFile(target, 'utf8')).toBe('OURS');
    expect(await fs.readdir(directory)).toEqual(['created.png']);
  },
);

it.each(['dev', 'ino', 'mtimeNs', 'ctimeNs', 'stat-error', 'unlink-error'])(
  'preserves files and the original failure when cleanup has %s uncertainty',
  async (fault) => {
    const target = path.join(directory, 'created.png');
    await expect(
      withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
        await create(target, (capture) => atomicWrite(target, 'OURS', capture));
        const lstat = fs.lstat.bind(fs);
        vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
          if (fault === 'stat-error') throw new Error('EIO');
          const stat = await lstat(...args);
          if (fault !== 'unlink-error') Object.assign(stat, { [fault]: undefined });
          return stat;
        });
        if (fault === 'unlink-error') vi.spyOn(fs, 'unlink').mockRejectedValue(new Error('EACCES'));
        throw originalError;
      }),
    ).rejects.toBe(originalError);
    expect(await fs.readFile(target, 'utf8')).toBe('OURS');
  },
);

it('does not mistake a committed member write for a committed project', async () => {
  const target = path.join(directory, 'created.png');
  const member = path.join(directory, 'description.md');
  const warning = new CommittedWriteError(member, originalError);
  await expect(
    withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
      await create(target, (capture) => atomicWrite(target, 'OURS', capture));
      await create(member, async (capture) => {
        await atomicWrite(member, 'MEMBER', capture);
        throw warning;
      });
    }),
  ).rejects.toBe(warning);
  await expect(fs.lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(member, 'utf8')).toBe('MEMBER');
});

it('refuses an occupied destination without invoking its writer', async () => {
  const target = path.join(directory, 'created.png');
  await fs.writeFile(target, 'FOREIGN');
  const write = vi.fn();
  await expect(
    withCreatedFileCleanup(path.join(directory, 'project.json'), (create) => create(target, write)),
  ).rejects.toThrow('destination already exists');
  expect(write).not.toHaveBeenCalled();
  expect(await fs.readFile(target, 'utf8')).toBe('FOREIGN');
});
