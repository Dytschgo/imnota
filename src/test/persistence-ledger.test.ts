// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { ProjectWatchManager } from '../../electron/project-watch';
import { PersistenceDiagnostics } from '../../electron/persistence-diagnostics';
import { writeApplicationFile } from '../../electron/application-persistence';
import { atomicWrite } from '../../electron/files';
import { emptyProject } from '../shared/utils';
import { persistenceLedger, persistenceSession, persistenceFault, trackWatch } from './persistence-ledger';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it('retains bounded monotonic evidence without serializing error messages or targets', async () => {
  const ledger = persistenceLedger(4);
  const fault = ledger.arm('/synthetic/private-target', 'candidate');
  fault.fire();
  await expect(
    ledger.span('write', async () => {
      throw Object.assign(new Error('/synthetic/private-payload'), { code: 'EIO' });
    }),
  ).rejects.toThrow();
  ledger.record('fixture', 'complete');
  const snapshot = ledger.snapshot();
  expect(snapshot.dropped).toBe(1);
  expect(snapshot.events).toHaveLength(4);
  expect(snapshot.events.map((event) => event.sequence)).toEqual([2, 3, 4, 5]);
  expect(snapshot.events.map((event) => event.ms)).toEqual(
    snapshot.events.map((event) => event.ms).sort((a, b) => a - b),
  );
  expect(JSON.stringify(snapshot)).not.toContain('/synthetic/private');
  expect(snapshot.events).toContainEqual(expect.objectContaining({ phase: 'error', code: 'EIO' }));
  ledger.assertIdle();
});

it('retains a sanitized checked fault in a failure snapshot after event overflow', async () => {
  const ledger = persistenceLedger(2);
  const fault = ledger.arm('/synthetic/private-target', 'directory');
  expect(ledger.snapshot().latestFault).toEqual({
    stage: 'directory',
    armed: true,
    fired: false,
    active: true,
    checked: false,
  });
  fault.fire();
  fault.assert();
  const barrier = deferred();
  const pending = ledger.span('later work', () => barrier.promise);
  ledger.record('later', 'event');
  ledger.record('later', 'event');
  try {
    const failure = await ledger.cleanup(0).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    const output = (failure as Error).message.split('[persistence-ledger] ')[1];
    const snapshot = JSON.parse(output);
    expect(snapshot).toMatchObject({
      activeFaults: 0,
      faults: [],
      latestFault: { stage: 'directory', armed: true, fired: true, active: false, checked: true },
    });
    expect(Object.keys(snapshot.latestFault).sort()).toEqual([
      'active',
      'armed',
      'checked',
      'fired',
      'stage',
    ]);
    expect(snapshot.dropped).toBeGreaterThan(0);
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.events.some((event: { phase: string }) => event.phase === 'fault-fired')).toBe(false);
    expect(output).not.toContain('/synthetic/private');
  } finally {
    barrier.resolve();
    await pending;
    await ledger.cleanup(1000);
  }
});

it('identifies pending work and prevents cleanup until it settles', async () => {
  const ledger = persistenceLedger(2);
  let release!: () => void;
  const pending = ledger.span(
    'candidate sync',
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  ledger.record('later', 'event');
  ledger.record('later', 'event');
  expect(ledger.snapshot().lastOutstandingSpan).toEqual([1, 'candidate sync']);
  expect(() => ledger.assertIdle()).toThrow('Retaining fixture');
  release();
  await pending;
  ledger.assertIdle();
  expect(ledger.snapshot().lastOutstandingSpan).toBeNull();
});

it('checks a missed fault at write settlement and preserves a fired write rejection', async () => {
  const ledger = persistenceLedger();
  const fault = ledger.arm('/synthetic/target', 'directory');
  await expect(ledger.checkFault('/synthetic/target', async () => undefined)).rejects.toThrow(
    'Injection never fired: expected directory fault; observed matching operations:',
  );
  fault.fire();
  const error = new Error('original rejection');
  await expect(
    ledger.checkFault('/synthetic/target', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  ledger.assertIdle();
});

it('retains the original pre-injection rejection as cause and records its sanitized boundary', async () => {
  const ledger = persistenceLedger();
  ledger.arm('/synthetic/private-target', 'directory');
  const error = Object.assign(new Error('/synthetic/private-payload'), { code: 'EIO' });
  const failed = ledger.span('Restore', () =>
    ledger.checkFault('/synthetic/private-target', async () => {
      throw error;
    }),
  );
  await expect(failed).rejects.toMatchObject({
    message: expect.stringContaining('Injection never fired'),
    cause: error,
  });
  expect(ledger.snapshot().events).toContainEqual(
    expect.objectContaining({ label: 'fault operation', phase: 'error', code: 'EIO', fired: false }),
  );
  expect(ledger.snapshot().events).toContainEqual(expect.objectContaining({ phase: 'injection-missed' }));
  expect(JSON.stringify(ledger.snapshot())).not.toContain('/synthetic/private');
});

it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid capacity %s', (capacity) => {
  expect(() => persistenceLedger(capacity)).toThrow('positive finite integer');
});

it('bounds unresolved details independently and keeps active counts after event overflow', async () => {
  const ledger = persistenceLedger(2);
  const barrier = deferred();
  const pending = Array.from({ length: 10 }, (_, i) => ledger.span(`boundary ${i}`, () => barrier.promise));
  const faults = Array.from({ length: 10 }, (_, i) => ledger.arm(`/synthetic/target-${i}`, 'directory'));
  try {
    const snapshot = ledger.snapshot();
    expect(snapshot).toMatchObject({ activeSpans: 10, spanOverflow: 8, activeFaults: 10, faultOverflow: 8 });
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.outstanding).toHaveLength(2);
    expect(snapshot.faults).toHaveLength(2);
    expect(snapshot.firstOutstandingSpan).toEqual([1, 'boundary 0']);
    expect(() => ledger.assertIdle()).toThrow('Retaining fixture');
    // Saturation must not skip the current injection's immediate assertion.
    await expect(ledger.checkFault('/synthetic/target-9', async () => undefined)).rejects.toThrow(
      'Injection never fired',
    );
  } finally {
    barrier.resolve();
    await Promise.all(pending);
    for (const fault of faults) {
      fault.fire();
      fault.assert();
    }
  }
  ledger.assertIdle();
  expect(ledger.snapshot()).toMatchObject({ activeSpans: 0, activeFaults: 0, outstanding: [], faults: [] });
});

it('isolates a timed-out lifetime from the next session after every await', async (context) => {
  const platform = process.platform;
  const session = persistenceSession();
  session.start(context);
  const first = session.ledger();
  const barrier = deferred();
  const error = new Error('controlled body timeout');
  const body = session.run(first, () =>
    first.span('test body', async () => {
      await barrier.promise;
      const owner = session.ledger();
      owner.record('late first-test boundary', 'begin');
      const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-ledger-')));
      owner.own(root, 'imnota-ledger-');
      await atomicWrite(path.join(root, 'project.json'), 'synthetic bytes');
      const fault = owner.arm('/synthetic/late-first', 'directory');
      fault.fire();
      await owner.span('late first-test span', () =>
        owner.checkFault('/synthetic/late-first', async () => undefined),
      );
      return owner;
    }),
  );
  try {
    // A controlled runner deadline returns while the actual body remains suspended.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const runner = Promise.race([
      body,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(error), 5);
      }),
    ]);
    const rejected = expect(runner).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(5);
    await rejected;
    vi.useRealTimers();
    await expect(first.cleanup(0)).rejects.toThrow('Retaining fixture: cleanup deadline');
    session.start(context);
    const second = session.ledger();
    const assertSecondFault = persistenceFault(second, '/synthetic/second-target', 'rename', 'EIO');
    await session.run(second, async () => {
      barrier.resolve();
      expect(await body).toBe(first);
      await session.ledger().span('second-test span', async () => undefined);
    });
    expect(first.snapshot().events).toContainEqual(
      expect.objectContaining({ label: 'late first-test boundary' }),
    );
    expect(second.snapshot().events.map(({ label }) => label)).toEqual([
      'rename',
      'second-test span',
      'second-test span',
    ]);
    expect(assertSecondFault).toThrow('Injection never fired');
    expect(second.snapshot()).toMatchObject({
      faults: [],
      activeSpans: 0,
      activeFaults: 0,
      retainedFixtures: 0,
    });
    expect(await first.cleanup(1000)).toBe('removed');
    expect(first.snapshot().retainedFixtures).toBe(0);
  } finally {
    vi.useRealTimers();
    barrier.resolve();
    await body;
    await first.cleanup(1000);
    vi.restoreAllMocks();
    Object.defineProperty(process, 'platform', { value: platform });
  }
});

it.each(['finite', 'deadline'] as const)(
  'safely cleans a real held native watch read at teardown (%s)',
  async (mode) => {
    const ledger = persistenceLedger();
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-ledger-')));
    ledger.own(root, 'imnota-ledger-');
    const file = path.join(root, 'project.json');
    const project = emptyProject('Ledger control', '');
    const barrier = deferred();
    let reading = false;
    const diagnostics = new PersistenceDiagnostics(() => path.join(root, 'diagnostics'), {
      version: 'test',
      platform: process.platform,
    });
    ledger.diagnostics(diagnostics);
    const manager = new ProjectWatchManager({
      readWatchedFile: (target) =>
        ledger.span('watch read', async () => {
          const bytes = await fs.readFile(target);
          reading = true;
          await barrier.promise;
          return bytes;
        }),
      loadSnapshot: async () => ({ projectPath: root, project, thumbnails: {}, recoveryFound: false }),
      saveProject: async () => {
        throw new Error('unused');
      },
      emit: () => {},
    });
    trackWatch(ledger, manager);
    ledger.stop(() => manager.stopAll());
    try {
      await fs.writeFile(file, JSON.stringify(project));
      await manager.start(root);
      await ledger.span('write', () =>
        writeApplicationFile(file, JSON.stringify({ ...project, name: 'Changed' }), {
          diagnostics,
          recordSelfWrite: (target, bytes) => manager.recordSelfWrite(target, bytes),
          invalidate: () => {},
        }),
      );
      await vi.waitFor(() => expect(reading).toBe(true));
      expect(ledger.snapshot().outstanding.map(([, label]) => label)).toEqual(['watch flush', 'watch read']);
      // Fake only the cleanup clock, after the real native watcher and filesystem read started.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let finished = false;
      const cleanup = ledger.cleanup(40).then(
        (result) => {
          finished = true;
          return result;
        },
        (error: unknown) => {
          finished = true;
          return error;
        },
      );
      await vi.advanceTimersByTimeAsync(39);
      expect(finished).toBe(false);
      expect(ledger.snapshot().retainedFixtures).toBe(1);
      expect((await fs.stat(root)).isDirectory()).toBe(true);
      if (mode === 'deadline') {
        await vi.advanceTimersByTimeAsync(1);
        expect(await cleanup).toMatchObject({
          message: expect.stringContaining('Retaining fixture: cleanup deadline'),
        });
        expect(ledger.snapshot().retainedFixtures).toBe(1);
      }
      barrier.resolve();
      vi.useRealTimers();
      expect(await ledger.cleanup(1000)).toBe('removed');
      if (mode === 'finite') expect(await cleanup).toBe('removed');
      expect(ledger.snapshot()).toMatchObject({ activeSpans: 0, retainedFixtures: 0 });
      await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      barrier.resolve();
      vi.useRealTimers();
      await ledger.cleanup(1000);
    }
  },
);

it('rejects a late fault installation before it can replace the next session injector', async (context) => {
  const platform = process.platform;
  const session = persistenceSession();
  session.start(context);
  const first = session.ledger();
  const firstRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-ledger-')));
  first.own(firstRoot, 'imnota-ledger-');
  const barrier = deferred();
  const late = session.run(first, () =>
    first.span('late fault body', async () => {
      await barrier.promise;
      expect(() =>
        persistenceFault(session.ledger(), path.join(firstRoot, 'first.json'), 'candidate', 'EIO'),
      ).toThrow('Cannot install a persistence fault from a closing session');
    }),
  );
  let second: ReturnType<typeof persistenceLedger> | undefined;
  try {
    await expect(first.cleanup(0)).rejects.toThrow('Retaining fixture: cleanup deadline');
    session.start(context);
    second = session.ledger();
    const secondRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-ledger-')));
    second.own(secondRoot, 'imnota-ledger-');
    const target = path.join(secondRoot, 'second.json');
    const assertFault = persistenceFault(second, target, 'candidate', 'EIO');
    barrier.resolve();
    await late;
    await expect(atomicWrite(target, 'synthetic bytes')).rejects.toMatchObject({ code: 'EIO' });
    assertFault();
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(first.snapshot().events).toContainEqual(
      expect.objectContaining({ label: 'late fault body', phase: 'end' }),
    );
    expect(second.snapshot().events).toContainEqual(
      expect.objectContaining({ label: 'candidate', phase: 'fault-fired' }),
    );
  } finally {
    barrier.resolve();
    await late.catch(() => undefined);
    await first.cleanup(1000);
    await second?.cleanup(1000);
    vi.restoreAllMocks();
    Object.defineProperty(process, 'platform', { value: platform });
  }
});

it('fails explicitly and retains fixtures when the private diagnostics queue is missing', async () => {
  const ledger = persistenceLedger();
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-ledger-')));
  ledger.own(root, 'imnota-ledger-');
  const diagnostics = new PersistenceDiagnostics(() => path.join(root, 'diagnostics'), {
    version: 'test',
    platform: process.platform,
  });
  // Model a private-member rename without starting any native I/O.
  Reflect.deleteProperty(diagnostics, 'queue');
  Reflect.set(diagnostics, 'pending', 1);
  ledger.diagnostics(diagnostics);
  try {
    await expect(ledger.cleanup(20)).rejects.toThrow('Diagnostics queue adapter is unavailable');
    expect(ledger.snapshot().retainedFixtures).toBe(1);
    expect((await fs.stat(root)).isDirectory()).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  } finally {
    // No queue or native work was started by this compatibility probe.
    await fs.rm(root, { recursive: true, force: true });
  }
});

it.each(['finite', 'runner-window', 'unresolved'] as const)(
  'uses the runner deadline without an early cutoff in the final worker (%s)',
  async (mode) => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-ledger-')));
    await fs.writeFile(path.join(root, 'fixture.txt'), 'synthetic bytes');
    const source = `
    // @vitest-environment node
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import { beforeEach, afterEach, expect, vi } from 'vitest';
    import { persistenceSession } from './persistence-ledger';
    const session = persistenceSession();
    let release;
    beforeEach(session.start);
    afterEach(async (context) => {
      try {
        if (${mode === 'finite'}) {
          // Virtualize only helper timers; Vitest keeps its own real hook deadline.
          vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
          let finished = false;
          const outcome = session.cleanup(context).finally(() => { finished = true; });
          setTimeout(() => release(), 29_950);
          await vi.advanceTimersByTimeAsync(29_900);
          expect(finished).toBe(false);
          await vi.advanceTimersByTimeAsync(50);
          vi.useRealTimers();
          await outcome;
        } else if (${mode === 'runner-window'}) {
          // Real finite work settles in the last 50 ms of the runner's 500 ms hook allowance.
          setTimeout(() => release(), 450);
          await session.cleanup(context);
        } else {
          // No helper timer: the real runner must fail and abort its public context signal.
          await session.cleanup(context);
        }
      } finally {
        vi.useRealTimers();
      }
    });
    session.it('${mode} fixture', async () => {
      const owner = session.ledger();
      owner.own(${JSON.stringify(root)}, 'imnota-ledger-');
      expect(await fs.readFile(path.join(${JSON.stringify(root)}, 'fixture.txt'), 'utf8')).toBe('synthetic bytes');
      void owner.span('unreleased background read', () => new Promise(resolve => { release = resolve; }));
    });
  `;
    const script = `
    import { startVitest } from 'vitest/node';
    const results = [], logs = [];
    const ctx = await startVitest('test', ['src/test/persistence-ledger.test.ts'], {
      watch: false, maxWorkers: 1, hookTimeout: 500,
      reporters: [{
        onTestCaseResult(test) { results.push(test.result()); },
        onUserConsoleLog(log) { logs.push(log.content); },
      }],
    }, { plugins: [{
      name: 'final-worker-control', enforce: 'pre',
      transform(code, id) {
        if (id.replaceAll('\\\\', '/').endsWith('/src/test/persistence-ledger.test.ts'))
          return { code: ${JSON.stringify(source)}, map: null };
      },
    }] });
    await ctx.close();
    process.exitCode = 0;
    console.log(JSON.stringify({ results, logs }));
  `;
    try {
      const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024,
      });
      const result = JSON.parse(stdout.trim());
      expect(result.results).toHaveLength(1);
      if (mode !== 'unresolved') {
        expect(result.results[0]).toMatchObject({ state: 'passed' });
        expect(result.logs.join('\n')).not.toContain('[persistence-ledger]');
        await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
      } else {
        expect(result.results[0]).toMatchObject({
          state: 'failed',
          errors: expect.arrayContaining([
            expect.objectContaining({ message: expect.stringContaining('Hook timed out in 500ms') }),
          ]),
        });
        expect(result.logs.join('\n')).toContain('[persistence-ledger]');
        expect(result.logs.join('\n')).toContain('unreleased background read');
        expect(result.logs.join('\n')).toContain('"retainedFixtures": 1');
        expect(await fs.readFile(path.join(root, 'fixture.txt'), 'utf8')).toBe('synthetic bytes');
      }
      expect(stdout).not.toContain(root);
    } finally {
      // The child and its worker have closed; the deliberately unresolved span has no live I/O.
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

it('reports a deletion error after the bounded cleanup has already failed', async () => {
  const ledger = persistenceLedger();
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-ledger-')));
  ledger.own(root, 'imnota-ledger-');
  const barrier = deferred();
  const pending = ledger.span('held background work', () => barrier.promise);
  const remove = fs.rm.bind(fs);
  const report = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(ledger.cleanup(0)).rejects.toThrow('Retaining fixture: cleanup deadline');
    vi.spyOn(fs, 'rm').mockRejectedValueOnce(
      Object.assign(new Error('/synthetic/private-deletion'), { code: 'EACCES' }),
    );
    barrier.resolve();
    await pending;
    await expect(ledger.cleanup(1000)).rejects.toThrow('Fixture cleanup failed (EACCES)');
    expect(report).toHaveBeenCalledOnce();
    const output = JSON.stringify(report.mock.calls);
    expect(output).toContain('[persistence-ledger]');
    expect(output).toContain('EACCES');
    expect(output).not.toContain('/synthetic/private-deletion');
    expect(output).not.toContain(root);
    expect(ledger.snapshot().retainedFixtures).toBe(1);
    expect((await fs.stat(root)).isDirectory()).toBe(true);
  } finally {
    barrier.resolve();
    await pending;
    vi.restoreAllMocks();
    await remove(root, { recursive: true, force: true });
  }
});
