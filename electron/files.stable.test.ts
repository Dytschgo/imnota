// @vitest-environment node
import fs from 'node:fs/promises';
import type { BigIntStats, Stats } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileReadLimitError, readStableRegularFile } from './files.js';

let directory: string;
let target: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'imnota-stable-'));
  target = path.join(directory, 'content.md');
  await fs.writeFile(target, 'original');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

// Preserve real open/read/stat/close operations; project only the tested stat fields.
function observeHandle(change?: (stat: Stats | BigIntStats, call: number) => void) {
  const open = fs.open.bind(fs);
  const closed = vi.fn();
  const read = vi.fn();
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    const stat = handle.stat.bind(handle);
    const close = handle.close.bind(handle);
    let calls = 0;
    handle.stat = (async (options?: { bigint?: boolean }) => {
      const value = options?.bigint ? await stat({ bigint: true }) : await stat();
      change?.(value, ++calls);
      return value;
    }) as typeof handle.stat;
    handle.close = async () => {
      await close();
      closed();
    };
    const originalRead = handle.read.bind(handle);
    handle.read = (async (...readArgs: Parameters<typeof handle.read>) => {
      await read();
      return originalRead(...readArgs);
    }) as typeof handle.read;
    return handle;
  });
  return { closed, read };
}

describe('stable regular file boundaries', () => {
  it.each(['ino', 'dev'] as const)('rejects exact %s replacement at the final boundary', async (field) => {
    const own = 9851624189743415n;
    const foreign = own + 1n;
    const replacement = path.join(directory, 'replacement');
    const original = path.join(directory, 'original');
    const moved = path.join(directory, 'opened');
    await fs.writeFile(replacement, 'foreign!');
    const other = field === 'ino' ? 'dev' : 'ino';
    const controls = observeHandle((stat) => {
      Object.assign(
        stat,
        typeof stat.ino === 'bigint'
          ? { [field]: foreign, [other]: 7n }
          : { [field]: Number(foreign), [other]: 7 },
      );
    });
    const lstat = fs.lstat.bind(fs);
    let observations = 0;
    vi.spyOn(fs, 'lstat').mockImplementation((async (file, options?: { bigint?: boolean }) => {
      const stat = options?.bigint ? await lstat(file, { bigint: true }) : await lstat(file);
      // Link guards do not compare identities. The first post-open identity observation
      // deliberately matches the opened file to isolate rejection at the FINAL boundary.
      if (String(file) === target && controls.read.mock.calls.length > 0) observations++;
      if (String(file) === target) {
        const exact = controls.read.mock.calls.length > 0 ? own : foreign;
        Object.assign(
          stat,
          typeof stat.ino === 'bigint'
            ? { [field]: exact, [other]: 7n }
            : { [field]: Number(exact), [other]: 7 },
        );
      }
      return stat;
    }) as typeof fs.lstat);
    await expect(
      readStableRegularFile(target, 100, {
        beforeOpen: async () => {
          await fs.rename(target, original);
          await fs.rename(replacement, target);
        },
        afterOpen: async () => {
          await fs.rename(target, moved);
          await fs.rename(original, target);
        },
      }),
    ).rejects.toThrow(/changed while it was read/);
    expect(observations).toBe(1);
    expect(await fs.readFile(target, 'utf8')).toBe('original');
    expect(await fs.readFile(moved, 'utf8')).toBe('foreign!');
    expect(controls.closed).toHaveBeenCalledOnce();
  });

  it.each(['mtime', 'ctime'] as const)('rejects same-byte sub-millisecond %s changes', async (field) => {
    const controls = observeHandle((stat, call) => {
      // Adjacent nanoseconds share an integral millisecond; Number Stats preserve a fraction.
      const ns = 1_000_000_000n + BigInt(call - 1) * 100n;
      Object.assign(
        stat,
        typeof stat.ino === 'bigint'
          ? { [`${field}Ns`]: ns, [`${field}Ms`]: ns / 1_000_000n }
          : { [`${field}Ms`]: Number(ns) / 1_000_000 },
      );
    });
    await expect(readStableRegularFile(target, 100)).rejects.toThrow(/changed/);
    expect(await fs.readFile(target, 'utf8')).toBe('original');
    expect(controls.closed).toHaveBeenCalledOnce();
  });

  it.each(['grow', 'shrink', 'same-size'] as const)(
    'rejects real %s mutation and closes its handle',
    async (mode) => {
      const controls = observeHandle();
      controls.read.mockImplementationOnce(async () => {
        await fs.writeFile(target, mode === 'grow' ? 'original-grown' : mode === 'shrink' ? 'x' : 'modified');
        // Real explicit timestamp change makes same-size mutation deterministic without a sleep.
        await fs.utimes(target, 1, 1);
      });
      await expect(readStableRegularFile(target, 100)).rejects.toThrow(/grew|changed/);
      expect(controls.closed).toHaveBeenCalledOnce();
    },
  );

  it.each(['read', 'stat', 'hook'] as const)('closes after a %s failure', async (boundary) => {
    const controls = observeHandle(() => {
      if (boundary === 'stat') throw new Error('stat denied');
    });
    if (boundary === 'read') controls.read.mockRejectedValue(new Error('read denied'));
    await expect(
      readStableRegularFile(target, 100, {
        afterOpen: async () => {
          if (boundary === 'hook') throw new Error('hook denied');
        },
      }),
    ).rejects.toThrow(`${boundary} denied`);
    expect(controls.closed).toHaveBeenCalledOnce();
  });

  it('keeps JSON-safe text/byte results at the exact byte bound, including empty and multibyte files', async () => {
    const controls = observeHandle();
    for (const text of ['', 'aé🙂']) {
      await fs.writeFile(target, text);
      const bytes = Buffer.byteLength(text);
      expect(JSON.parse(JSON.stringify(await readStableRegularFile(target, bytes)))).toEqual({ text, bytes });
    }
    expect(controls.closed).toHaveBeenCalledTimes(2);
    await expect(readStableRegularFile(target, 1)).rejects.toBeInstanceOf(FileReadLimitError);
    expect(controls.closed).toHaveBeenCalledTimes(3);
    expect(await readStableRegularFile(path.join(directory, 'absent'), 100)).toBeNull();
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER])(
    'refuses unsafe configured bound %s before opening',
    async (maximum) => {
      const open = vi.spyOn(fs, 'open');
      await expect(readStableRegularFile(target, maximum)).rejects.toBeInstanceOf(FileReadLimitError);
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('rejects an oversized exact stat before allocating or reading', async () => {
    const controls = observeHandle((stat) =>
      Object.assign(stat, {
        size: typeof stat.size === 'bigint' ? 9007199254740993n : Number(9007199254740993n),
      }),
    );
    await expect(readStableRegularFile(target, 100)).rejects.toBeInstanceOf(FileReadLimitError);
    expect(controls.read).not.toHaveBeenCalled();
    expect(controls.closed).toHaveBeenCalledOnce();
  });

  it('rejects a real linked ancestor without reading its target', async () => {
    const linked = path.join(directory, 'linked');
    const outside = path.join(directory, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret'), 'foreign bytes');
    await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const open = vi.spyOn(fs, 'open');
    await expect(readStableRegularFile(path.join(linked, 'secret'), 100)).rejects.toThrow(/Linked/);
    expect(open).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(outside, 'secret'), 'utf8')).toBe('foreign bytes');
  });
});
