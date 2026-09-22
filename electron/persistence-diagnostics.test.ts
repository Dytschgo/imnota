// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersistenceDiagnostics, tracesPersistenceChannel } from './persistence-diagnostics.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function currentLog(directory: string): Promise<string> {
  const name = (await fs.readdir(directory)).find(
    (name) => name.endsWith('.jsonl') && !name.endsWith('.previous.jsonl'),
  );
  if (!name) throw new Error('No current diagnostic log');
  return path.join(directory, name);
}
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-diagnostics-')));
  roots.push(root);
  const directory = path.join(root, 'diagnostics');
  return {
    root,
    directory,
    trace: new PersistenceDiagnostics(() => directory, { version: '0.2.9-test', platform: 'win32' }),
  };
}

describe('local persistence diagnostics', () => {
  it('records explicit OOM evidence and available memory without serializing raw process details', async () => {
    const { directory, trace } = await fixture();
    const details = {
      type: 'Tab',
      reason: 'oom',
      exitCode: -1,
      name: 'secret-window-title',
      serviceName: 'private-service',
      path: 'C:\\private-user\\secret.png',
    };
    await trace.record({
      category: 'lifecycle',
      action: 'renderer-gone',
      phase: 'observed',
      termination: {
        details,
        memory: {
          mainResidentBytes: () => 125 * 1024 ** 2,
          processMetrics: () => [
            { type: 'Browser', memory: { workingSetSize: 125 * 1024 } },
            { type: 'GPU', memory: { workingSetSize: 300 * 1024 }, name: 'private-GPU-name' },
            { type: 'Utility', memory: { workingSetSize: 50 * 1024 } },
          ],
        },
      },
    });
    const raw = await fs.readFile(await currentLog(directory), 'utf8');
    expect(raw).not.toMatch(/secret|private|serviceName|peak|pid/i);
    expect(JSON.parse(raw).termination).toEqual({
      processType: 'Tab',
      reason: 'oom',
      exitCode: -1,
      memory: {
        observedAt: 'termination',
        mainResidentMiB: 125,
        availableChildWorkingSetMiB: 350,
        availableChildProcessCount: 2,
      },
    });
  });

  it('preserves a crash reason when memory measurements fail without inventing zero readings', async () => {
    const { directory, trace } = await fixture();
    await trace.record({
      category: 'lifecycle',
      action: 'child-process-gone',
      phase: 'observed',
      termination: {
        details: { type: 'GPU', reason: 'crashed', exitCode: 0xc000_0005 },
        memory: {
          mainResidentBytes: () => {
            throw new Error('private-memory-error');
          },
          processMetrics: () => {
            throw new Error('private-metrics-error');
          },
        },
      },
    });
    const raw = await fs.readFile(await currentLog(directory), 'utf8');
    expect(raw).not.toContain('private');
    expect(JSON.parse(raw).termination).toEqual({
      processType: 'GPU',
      reason: 'crashed',
      exitCode: 0xc000_0005,
      memory: { observedAt: 'termination' },
    });
  });

  it('bounds termination metrics and rejects unknown reason and process strings', async () => {
    const { directory, trace } = await fixture();
    await trace.record({
      category: 'lifecycle',
      action: 'child-process-gone',
      phase: 'observed',
      termination: {
        details: {
          type: 'private-process-name',
          reason: 'private-failure-message',
          exitCode: Number.MAX_SAFE_INTEGER,
        },
        memory: {
          mainResidentBytes: () => Number.MAX_VALUE,
          processMetrics: () =>
            Array.from({ length: 5000 }, () => ({
              type: 'Utility',
              memory: { workingSetSize: Number.MAX_VALUE },
            })),
        },
      },
    });
    const raw = await fs.readFile(await currentLog(directory), 'utf8');
    expect(raw).not.toContain('private');
    expect(JSON.parse(raw).termination).toEqual({
      processType: 'Unknown',
      reason: 'unknown',
      exitCode: 0xffff_ffff,
      memory: {
        observedAt: 'termination',
        mainResidentMiB: 1_048_576,
        availableChildWorkingSetMiB: 1_048_576,
        availableChildProcessCount: 4096,
      },
    });
  });

  it('omits invalid termination numbers and excludes invalid memory readings', async () => {
    const { directory, trace } = await fixture();
    await trace.record({
      category: 'lifecycle',
      action: 'renderer-gone',
      phase: 'observed',
      termination: {
        details: { type: 'Tab', reason: 'memory-eviction', exitCode: 'private-exit-code' },
        memory: {
          mainResidentBytes: () => Number.NaN,
          processMetrics: () => [
            { type: 'GPU', memory: { workingSetSize: Number.POSITIVE_INFINITY } },
            { type: 'Tab', memory: { workingSetSize: -1 } },
          ],
        },
      },
    });
    const raw = await fs.readFile(await currentLog(directory), 'utf8');
    expect(raw).not.toContain('private');
    expect(JSON.parse(raw).termination).toEqual({
      processType: 'Tab',
      reason: 'memory-eviction',
      memory: { observedAt: 'termination', availableChildWorkingSetMiB: 0, availableChildProcessCount: 0 },
    });
  });

  it('prunes only older inactive diagnostic files, preserving active or uncertain sessions and links', async () => {
    const { root, directory, trace } = await fixture();
    await trace.openDirectory();
    const name = (pid: number) => `operations-${pid}-00000000-0000-0000-0000-000000000000.jsonl`;
    for (let pid = 100; pid < 106; pid++) {
      const file = path.join(directory, name(pid));
      await fs.writeFile(file, 'old log');
      await fs.utimes(file, pid, pid);
    }
    await fs.writeFile(path.join(directory, name(200)), 'active');
    await fs.writeFile(path.join(directory, name(201)), 'unknown');
    await fs.writeFile(path.join(directory, 'notes.txt'), 'user file');
    await fs.mkdir(path.join(directory, name(202)));
    const target = path.join(root, 'preserve-target');
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'keep.txt'), 'preserve');
    await fs.symlink(target, path.join(directory, name(203)), 'junction');
    vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === 200) return true;
      throw Object.assign(new Error('synthetic process status'), { code: pid === 201 ? 'EPERM' : 'ESRCH' });
    });
    expect(await trace.record({ category: 'lifecycle', action: 'startup', phase: 'observed' })).toBe(true);
    const files = await fs.readdir(directory);
    expect(files).not.toContain(name(100));
    expect(files).not.toContain(name(101));
    for (const pid of [102, 103, 104, 105, 200, 201, 202, 203]) expect(files).toContain(name(pid));
    expect(await fs.readFile(path.join(directory, 'notes.txt'), 'utf8')).toBe('user file');
    expect(await fs.readFile(path.join(target, 'keep.txt'), 'utf8')).toBe('preserve');
  });

  it('keeps concurrent app sessions separate during rotation', async () => {
    const { directory, trace } = await fixture();
    const other = new PersistenceDiagnostics(() => directory, { version: 'test', platform: 'win32' });
    await trace.record({ category: 'lifecycle', action: 'first', phase: 'observed' });
    const first = await currentLog(directory);
    await other.record({ category: 'lifecycle', action: 'second', phase: 'observed' });
    const second = (await fs.readdir(directory))
      .map((name) => path.join(directory, name))
      .find((file) => file !== first)!;
    const secondSource = await fs.readFile(second, 'utf8');
    await fs.writeFile(first, 'x'.repeat(1_048_576));
    await trace.record({ category: 'lifecycle', action: 'first', phase: 'observed' });
    expect(await fs.readFile(second, 'utf8')).toBe(secondSource);
    expect((await fs.stat(first.replace(/\.jsonl$/, '.previous.jsonl'))).size).toBe(1_048_576);
  });

  it('stops waiting on stalled diagnostics without changing save results', async () => {
    const { trace } = await fixture();
    vi.useFakeTimers();
    let release!: () => void;
    const stalled = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(trace, 'openDirectory').mockImplementation(async () => {
      await stalled;
      throw new Error('diagnostic disk unavailable');
    });
    try {
      const save = vi.fn(async () => 'saved');
      const pending = trace.run('projects:save', save);
      await vi.advanceTimersByTimeAsync(1500);
      expect(await pending).toBe('saved');
      expect(await trace.run('projects:save', save)).toBe('saved');
      expect(save).toHaveBeenCalledTimes(2);
      expect(trace.openDirectory).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
  });

  it('correlates operations and file checkpoints without exposing paths, error messages or content', async () => {
    const { root, directory, trace } = await fixture();
    const target = path.join(root, 'private-user', 'private-project', 'secret.png');
    const failure = Object.assign(new Error('secret screenshot text and private-user path'), {
      code: 'ENOSPC',
    });
    await expect(
      trace.run('screenshots:delete', () =>
        trace.filesystem('trash', target, async () => {
          throw failure;
        }),
      ),
    ).rejects.toThrow(/Diagnostic reference:/);
    const raw = await fs.readFile(await currentLog(directory), 'utf8');
    expect(raw).not.toMatch(/private-user|private-project|secret|stack/);
    const entries = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(entries.map((entry) => [entry.category, entry.phase])).toEqual([
      ['operation', 'begin'],
      ['filesystem', 'begin'],
      ['filesystem', 'failed'],
      ['operation', 'failed'],
    ]);
    expect(new Set(entries.map((entry) => entry.operationId)).size).toBe(1);
    expect(entries[1].targetId).toBe(entries[2].targetId);
    expect(entries[2].errorCode).toBe('ENOSPC');
    expect(failure.message).toContain(entries[0].operationId);
  });

  it('rotates only its own log files and keeps a bounded previous log', async () => {
    const { directory, trace } = await fixture();
    await trace.record({ category: 'lifecycle', action: 'startup', phase: 'observed' });
    const previous = (await currentLog(directory)).replace(/\.jsonl$/, '.previous.jsonl');
    await fs.writeFile(await currentLog(directory), 'x'.repeat(1_048_576));
    await fs.writeFile(previous, 'old');
    await fs.writeFile(path.join(directory, 'user-file.txt'), 'preserve');
    expect(await trace.record({ category: 'lifecycle', action: 'startup', phase: 'observed' })).toBe(true);
    expect((await fs.stat(previous)).size).toBe(1_048_576);
    expect((await fs.stat(await currentLog(directory))).size).toBeLessThan(1024);
    expect(await fs.readFile(path.join(directory, 'user-file.txt'), 'utf8')).toBe('preserve');
  });

  it('preserves operation outcomes when diagnostics storage fails and refuses linked directories', async () => {
    const { root, directory, trace } = await fixture();
    await fs.writeFile(directory, 'not a directory');
    expect(await trace.run('projects:save', async () => 'saved')).toBe('saved');
    await expect(
      trace.run('projects:save', async () => {
        throw new Error('Original failure');
      }),
    ).rejects.toThrow('Original failure');
    const linked = path.join(root, 'linked');
    await fs.symlink(root, linked, 'junction');
    const linkedTrace = new PersistenceDiagnostics(() => path.join(linked, 'logs'), {
      version: 'test',
      platform: 'win32',
    });
    expect(await linkedTrace.record({ category: 'lifecycle', action: 'startup', phase: 'observed' })).toBe(
      false,
    );
    await expect(fs.stat(path.join(root, 'logs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not cross-correlate overlapping operations or call a structured failure successful', async () => {
    const { directory, trace } = await fixture();
    await Promise.all([
      trace.run('projects:save', async () => ({ ok: false })),
      trace.run('content:save', async () => ({ ok: true })),
    ]);
    const entries = (await fs.readFile(await currentLog(directory), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(entries.filter((entry) => entry.action === 'projects:save').map((entry) => entry.phase)).toEqual([
      'begin',
      'failed',
    ]);
    expect(entries.filter((entry) => entry.action === 'content:save').map((entry) => entry.phase)).toEqual([
      'begin',
      'complete',
    ]);
    expect(new Set(entries.map((entry) => entry.operationId)).size).toBe(2);
    expect(tracesPersistenceChannel('workflow:hosted-share:create')).toBe(false);
    expect(tracesPersistenceChannel('system:copy-text')).toBe(false);
    expect(tracesPersistenceChannel('screenshots:delete')).toBe(true);
    expect(tracesPersistenceChannel('workflow:project-watch:cas')).toBe(true);
  });
});
