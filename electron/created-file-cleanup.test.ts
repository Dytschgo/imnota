// @vitest-environment node
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withCreatedFileCleanup } from './created-file-cleanup.js';
import { atomicWrite, CommittedWriteError } from './files.js';

// Windows does not export these POSIX flags. Supply test-only values so the
// injected POSIX-open branch is still checked on Windows without native I/O.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    constants: {
      ...actual.constants,
      O_NOFOLLOW: actual.constants.O_NOFOLLOW ?? 0x20000,
      O_NONBLOCK: actual.constants.O_NONBLOCK ?? 0x800,
    },
  };
});

const platform = process.platform;
let directory: string;
const originalError = new Error('Injected metadata save failure');
beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-owned-write-')));
});
afterEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', { value: platform });
  await fs.rm(directory, { recursive: true, force: true });
});

it.each(['linux', 'win32'])(
  'preserves a non-regular opened descriptor without reading it (%s flags)',
  async (system) => {
    const target = path.join(directory, 'created.png');
    const read = vi.fn();
    const close = vi.fn(async () => undefined);
    let open: ReturnType<typeof vi.spyOn> | undefined;
    await expect(
      withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
        await create(target, (capture) => atomicWrite(target, 'OURS', capture));
        const stat = await fs.lstat(target, { bigint: true });
        Object.defineProperty(process, 'platform', { value: system });
        open = vi.spyOn(fs, 'open').mockResolvedValue({
          stat: vi.fn(async () => Object.assign(stat, { isFile: () => false })),
          read,
          close,
        } as unknown as Awaited<ReturnType<typeof fs.open>>);
        throw originalError;
      }),
    ).rejects.toBe(originalError);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      target,
      fsConstants.O_RDONLY | (system === 'win32' ? 0 : fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK),
    );
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(await fs.readFile(target, 'utf8')).toBe('OURS');
  },
);

it.skipIf(platform === 'win32')(
  'preserves a FIFO swapped in just before cleanup open (requires POSIX mkfifo; unavailable on Windows)',
  async () => {
    const target = path.join(directory, 'created.png');
    const open = fs.open.bind(fs);
    let openedFlags: number | undefined;
    await expect(
      withCreatedFileCleanup(path.join(directory, 'project.json'), async (create) => {
        await create(target, (capture) => atomicWrite(target, 'OURS', capture));
        vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
          await fs.unlink(target);
          execFileSync('mkfifo', [target]);
          openedFlags = Number(args[1]);
          // Fail a regression without stranding a worker in a blocking FIFO open.
          if (!(openedFlags & fsConstants.O_NONBLOCK)) throw new Error('Blocking FIFO open refused');
          return open(...args);
        });
        throw originalError;
      }),
    ).rejects.toBe(originalError);
    expect(openedFlags).toBe(fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    expect((await fs.lstat(target)).isFIFO()).toBe(true);
  },
);

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
