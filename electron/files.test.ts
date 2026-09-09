import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atomicWrite } from './files.js';

const platform = process.platform;
const rename = fs.rename.bind(fs);
let directory: string;
let target: string;
const failure = (code: string) => Object.assign(new Error(code), { code });

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-atomic-test-'));
  target = path.join(directory, 'drawing.json');
  await fs.writeFile(target, 'baseline');
});

afterEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', { value: platform });
  await fs.rm(directory, { recursive: true, force: true });
});

describe('atomic replacement', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])(
    'retries transient Windows %s without removing the destination',
    async (code) => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const replace = vi.spyOn(fs, 'rename').mockImplementationOnce(async () => {
        expect(await fs.readFile(target, 'utf8')).toBe('baseline');
        throw failure(code);
      });
      await atomicWrite(target, 'candidate');
      expect(replace).toHaveBeenCalledTimes(2);
      expect(await fs.readFile(target, 'utf8')).toBe('candidate');
      expect(await fs.readdir(directory)).toEqual(['drawing.json']);
    },
  );

  it.each([
    ['linux', 'EPERM'],
    ['win32', 'ENOSPC'],
  ])('does not retry %s %s', async (system, code) => {
    Object.defineProperty(process, 'platform', { value: system });
    const replace = vi.spyOn(fs, 'rename').mockRejectedValue(failure(code));
    await expect(atomicWrite(target, 'candidate')).rejects.toMatchObject({ code });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(target, 'utf8')).toBe('baseline');
    expect(await fs.readdir(directory)).toEqual(['drawing.json']);
  });

  it('preserves committed data and removes the temporary file when a lock persists', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const replace = vi.spyOn(fs, 'rename').mockRejectedValue(failure('EPERM'));
    await expect(atomicWrite(target, 'candidate')).rejects.toMatchObject({ code: 'EPERM' });
    expect(replace).toHaveBeenCalledTimes(6);
    expect(await fs.readFile(target, 'utf8')).toBe('baseline');
    expect(await fs.readdir(directory)).toEqual(['drawing.json']);
  });

  it('bounds persistent lock retries, cleans the temporary file, and advances queued writes', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    let calls = 0;
    const replace = vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      if (++calls <= 6) throw failure('EPERM');
      return rename(...args);
    });
    const first = expect(atomicWrite(target, 'failed candidate')).rejects.toMatchObject({ code: 'EPERM' });
    const second = atomicWrite(target, 'next candidate');
    await first;
    await second;
    expect(replace).toHaveBeenCalledTimes(7);
    expect(await fs.readFile(target, 'utf8')).toBe('next candidate');
    expect(await fs.readdir(directory)).toEqual(['drawing.json']);
  });

  it('rechecks links before retrying a denied replacement', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const lstat = fs.lstat.bind(fs);
    let denied = false;
    const replace = vi.spyOn(fs, 'rename').mockImplementation(async () => {
      denied = true;
      throw failure('EPERM');
    });
    vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      const stat = await lstat(...args);
      if (denied && args[0] === target) stat.isSymbolicLink = () => true;
      return stat;
    });
    await expect(atomicWrite(target, 'candidate')).rejects.toThrow('Linked workspace paths');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(target, 'utf8')).toBe('baseline');
    expect(await fs.readdir(directory)).toEqual(['drawing.json']);
  });

  it.skipIf(platform !== 'win32').each([false, true])(
    'handles a real Windows no-delete-share reader (persistent: %s)',
    async (persistent) => {
      const quoted = target.replaceAll("'", "''");
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `$f=[IO.File]::Open('${quoted}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);[Console]::WriteLine('LOCKED');[Console]::ReadLine()|Out-Null;$f.Dispose()`,
        ],
        { windowsHide: true },
      );
      const exited = once(child, 'exit');
      try {
        await new Promise<void>((resolve, reject) => {
          let output = '';
          const timer = setTimeout(() => finish(new Error('Windows reader did not acquire its lock')), 5_000);
          const onExit = () => finish(new Error('Windows reader exited before acquiring its lock'));
          const onError = (error: Error) => finish(error);
          const onData = (data: Buffer) => {
            output += data.toString();
            if (output.includes('LOCKED')) finish();
          };
          const finish = (error?: Error) => {
            clearTimeout(timer);
            child.off('exit', onExit);
            child.off('error', onError);
            child.stdout!.off('data', onData);
            if (error) reject(error);
            else resolve();
          };
          child.on('exit', onExit);
          child.on('error', onError);
          child.stdout!.on('data', onData);
        });
        let observedLock = false;
        vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
          try {
            return await rename(...args);
          } catch (error) {
            expect((error as NodeJS.ErrnoException).code).toBe('EPERM');
            observedLock = true;
            expect(await fs.readFile(target, 'utf8')).toBe('baseline');
            if (!persistent) {
              child.stdin!.end('\n');
              await exited;
            }
            throw error;
          }
        });
        if (persistent)
          await expect(atomicWrite(target, 'candidate')).rejects.toMatchObject({ code: 'EPERM' });
        else await atomicWrite(target, 'candidate');
        expect(observedLock).toBe(true);
        expect(await fs.readFile(target, 'utf8')).toBe(persistent ? 'baseline' : 'candidate');
        expect(await fs.readdir(directory)).toEqual(['drawing.json']);
      } finally {
        child.kill();
        await exited;
      }
    },
    15_000,
  );
});
