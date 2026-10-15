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

it.each(['before capture', 'after capture'])(
  'preserves a same-size edit with restored mtime %s',
  async (interleaving) => {
    const target = path.join(directory, 'created.png');
    const restoredTime = new Date('2024-01-01T00:00:00Z');
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[1] === 'wx') {
        const sync = handle.sync.bind(handle);
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          await sync();
          await fs.utimes(args[0], restoredTime, restoredTime);
        });
      }
      return handle;
    });
    const edit = async () => {
      const before = await fs.lstat(target, { bigint: true });
      await fs.writeFile(target, 'EDIT');
      await fs.utimes(target, restoredTime, restoredTime);
      const after = await fs.lstat(target, { bigint: true });
      expect([after.dev, after.ino, after.size, after.mtimeNs]).toEqual([
        before.dev,
        before.ino,
        before.size,
        before.mtimeNs,
      ]);
    };
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      await rename(...args);
      // Real edit + native timestamp restoration after publication, before the
      // writer can return evidence (and before the old witness's post-rename stat).
      if (interleaving === 'before capture') await edit();
    });
    await expect(
      withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
        await create(target, (capture) => atomicWrite(target, 'OURS', capture));
        if (interleaving === 'after capture') await edit();
        throw originalError;
      }),
    ).rejects.toBe(originalError);
    expect(await fs.readFile(target, 'utf8')).toBe('EDIT');
  },
);

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

it('preserves edited bytes even when every metadata field is unchanged', async () => {
  const target = path.join(directory, 'created.png');
  await expect(
    withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
      await create(target, (capture) => atomicWrite(target, 'OURS', capture));
      const baseline = await fs.lstat(target, { bigint: true });
      await fs.writeFile(target, 'EDIT');
      const project = <T>(stat: T): T =>
        Object.assign(stat as object, {
          dev: baseline.dev,
          ino: baseline.ino,
          size: baseline.size,
          mtimeNs: baseline.mtimeNs,
          ctimeNs: baseline.ctimeNs,
        }) as T;
      const lstat = fs.lstat.bind(fs);
      vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => project(await lstat(...args)));
      const open = fs.open.bind(fs);
      vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const handle = await open(...args);
        const stat = handle.stat.bind(handle);
        vi.spyOn(handle, 'stat').mockImplementation(async (...options) => project(await stat(...options)));
        return handle;
      });
      throw originalError;
    }),
  ).rejects.toBe(originalError);
  expect(await fs.readFile(target, 'utf8')).toBe('EDIT');
});

it('can remove byte-identical rewrites of the same file', async () => {
  const target = path.join(directory, 'created.png');
  await expect(
    withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
      await create(target, (capture) => atomicWrite(target, 'OURS', capture));
      await fs.writeFile(target, 'OURS');
      await fs.utimes(target, new Date('2024-01-01'), new Date('2024-01-01'));
      throw originalError;
    }),
  ).rejects.toBe(originalError);
  await expect(fs.lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('skips content reads when size differs', async () => {
  const target = path.join(directory, 'created.png');
  const open = vi.spyOn(fs, 'open');
  await expect(
    withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
      await create(target, (capture) => atomicWrite(target, 'OURS', capture));
      await fs.writeFile(target, 'LONGER EDIT');
      open.mockClear();
      throw originalError;
    }),
  ).rejects.toBe(originalError);
  expect(open).not.toHaveBeenCalled();
  expect(await fs.readFile(target, 'utf8')).toBe('LONGER EDIT');
});

it.each(['open', 'read', 'stat', 'growth', 'replacement'])(
  'preserves the file and original error on rollback read %s uncertainty',
  async (fault) => {
    const target = path.join(directory, 'created.png');
    const foreign = path.join(directory, 'foreign.png');
    await fs.writeFile(foreign, 'OURS');
    await expect(
      withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
        await create(target, (capture) => atomicWrite(target, 'OURS', capture));
        const open = fs.open.bind(fs);
        vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
          if (fault === 'open') throw new Error('EACCES');
          const handle = await open(...args);
          if (fault === 'stat') vi.spyOn(handle, 'stat').mockRejectedValue(new Error('EIO'));
          if (fault === 'read') vi.spyOn(handle, 'read').mockRejectedValue(new Error('EIO'));
          if (fault === 'growth' || fault === 'replacement') {
            const read = handle.read.bind(handle);
            vi.spyOn(handle, 'read').mockImplementationOnce(async (...options) => {
              if (fault === 'growth') await fs.appendFile(target, 'GROWTH');
              else await fs.rename(foreign, target);
              return read(...options);
            });
          }
          return handle;
        });
        throw originalError;
      }),
    ).rejects.toBe(originalError);
    expect(await fs.readFile(target, 'utf8')).toBe(fault === 'growth' ? 'OURSGROWTH' : 'OURS');
  },
);

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
  // Even byte-identical content cannot authorize removal of a different inode.
  await fs.writeFile(foreign, 'OURS');
  await expect(
    withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
      await create(target, (capture) => atomicWrite(target, 'OURS', capture));
      await fs.rename(foreign, target);
      throw originalError;
    }),
  ).rejects.toBe(originalError);
  expect(await fs.readFile(target, 'utf8')).toBe('OURS');
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

it.each(['writer-stat', 'unsupported-identity'])(
  'preserves a write when %s cannot provide evidence',
  async (stage) => {
    const target = path.join(directory, 'created.png');
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const temporary = String(args[0]).includes('.tmp-');
      const handle = await open(...args);
      if (temporary && args[1] === 'wx') {
        if (stage === 'writer-stat') vi.spyOn(handle, 'stat').mockRejectedValue(new Error('EIO'));
        else {
          const stat = handle.stat.bind(handle);
          vi.spyOn(handle, 'stat').mockImplementation(async (...options) =>
            Object.assign(await stat(...options), { ino: 0n }),
          );
        }
      }
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
