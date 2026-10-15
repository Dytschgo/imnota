import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { expect, it as vitestIt, onTestFailed, vi } from 'vitest';
import type { TestContext } from 'vitest';
import type { PersistenceDiagnostics } from '../../electron/persistence-diagnostics.js';

const platform = process.platform;
const realOpen = fs.open.bind(fs);
const realRename = fs.rename.bind(fs);
type Stage = 'candidate' | 'directory' | 'rename';
type Event = { sequence: number; ms: number; label: string; phase: string; span?: number } & Record<
  string,
  string | number | boolean | undefined
>;

/** Test-only evidence: fixed labels and errno codes, never paths, payloads or error messages. */
export function persistenceLedger(capacity = 256) {
  if (!Number.isSafeInteger(capacity) || capacity < 1)
    throw new RangeError('Ledger capacity must be a positive finite integer');
  const start = performance.now();
  const events: Event[] = [];
  const outstanding = new Map<number, string>();
  type Fault = { target: string; stage: Stage; fired: boolean; active: boolean; assert: () => void };
  const faults = new Set<Fault>();
  // One lookup slot beyond the bounded oldest details keeps the current injection checkable.
  let latestFault: Fault | undefined;
  let diagnostics: PersistenceDiagnostics | undefined;
  let sequence = 0;
  let dropped = 0;
  let activeSpans = 0;
  let spanOverflow = 0;
  let activeFaults = 0;
  let faultOverflow = 0;
  let settled = Promise.resolve();
  let resolveSettled = () => {};
  const roots = new Map<string, string>();
  const stops = new Set<() => void | Promise<void>>();
  let closing = false;
  let cleanupTask: Promise<void> | undefined;
  let cleanupExpired = false;
  const record = (label: string, phase: string, details: Record<string, string | number | boolean> = {}) => {
    const event = {
      sequence: ++sequence,
      ms: +(performance.now() - start).toFixed(3),
      label,
      phase,
      ...details,
    };
    if (events.length === capacity) {
      events.shift();
      dropped++;
    }
    events.push(event);
    return event.sequence;
  };
  const errorCode = (error: unknown) => {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return typeof code === 'string' && /^E[A-Z]+$/.test(code) ? code : 'other';
  };
  const snapshot = () => ({
    dropped,
    diagnostics: diagnostics?.health() ?? 'unavailable',
    activeSpans,
    spanOverflow,
    activeFaults,
    faultOverflow,
    faults: [...faults].map(({ stage, fired }) => ({ stage, armed: true, fired })),
    latestFault: latestFault
      ? {
          stage: latestFault.stage,
          armed: true,
          fired: latestFault.fired,
          active: latestFault.active,
          checked: !latestFault.active,
        }
      : null,
    firstOutstandingSpan: [...outstanding].at(0) ?? null,
    lastOutstandingSpan: [...outstanding].at(-1) ?? null,
    outstanding: [...outstanding],
    retainedFixtures: roots.size,
    events: [...events],
  });
  const report = () => console.error('[persistence-ledger]', JSON.stringify(snapshot(), null, 2));
  const cleanupError = (message: string) =>
    new Error(`${message}\n[persistence-ledger] ${JSON.stringify(snapshot())}`);
  onTestFailed(report);
  const span = async <T>(
    label: string,
    run: () => Promise<T>,
    details?: Record<string, string | number | boolean>,
  ) => {
    const id = record(label, 'begin', details);
    if (activeSpans++ === 0)
      settled = new Promise<void>((resolve) => {
        resolveSettled = resolve;
      });
    if (outstanding.size < capacity) outstanding.set(id, label);
    else spanOverflow++;
    try {
      const result = await run();
      record(label, 'end', { span: id });
      return result;
    } catch (error) {
      record(label, 'error', { span: id, code: errorCode(error) });
      throw error;
    } finally {
      outstanding.delete(id);
      if (--activeSpans === 0) resolveSettled();
    }
  };
  const idle = async () => {
    do {
      await settled;
      // Test-only access to the actual queue: record() may return before a stalled write settles.
      if (diagnostics) {
        const queue = (diagnostics as unknown as { queue?: PromiseLike<void> }).queue;
        if (!queue || typeof queue.then !== 'function')
          throw new Error('Diagnostics queue adapter is unavailable; retaining fixtures');
        await queue;
      }
    } while (activeSpans || (diagnostics?.health().pending ?? 0));
  };
  const stop = (close: () => void | Promise<void>) =>
    span('fixture stop', async () => {
      await close();
    });
  return {
    record,
    span,
    snapshot,
    diagnostics: (source: PersistenceDiagnostics) => {
      diagnostics = source;
    },
    own: (root: string, prefix: string) => {
      roots.set(root, prefix);
    },
    fixtureRoots: () => [...roots.keys()],
    isClosing: () => closing,
    stop: (close: () => void | Promise<void>) => {
      if (closing)
        void stop(close).catch((error: unknown) =>
          record('fixture stop', 'error', { code: errorCode(error) }),
        );
      else stops.add(close);
    },
    cleanup: async (deadline: number | AbortSignal) => {
      if (!cleanupTask) {
        closing = true;
        cleanupTask = (async () => {
          await Promise.all([...stops].map(stop));
          stops.clear();
          await idle();
          for (const [root, prefix] of roots) {
            if (
              path.dirname(root) !== (await fs.realpath(os.tmpdir())) ||
              !path.basename(root).startsWith(prefix)
            )
              throw new Error('Unexpected fixture cleanup');
            await fs.rm(root, { recursive: true, force: true });
            roots.delete(root);
          }
        })().catch((error: unknown) => {
          const code = errorCode(error);
          record('fixture cleanup', 'error', { code });
          const message =
            error instanceof Error &&
            error.message === 'Diagnostics queue adapter is unavailable; retaining fixtures'
              ? error.message
              : `Fixture cleanup failed (${code}); retaining fixtures`;
          throw cleanupError(message);
        });
        // Best effort only while this worker lives. A pending promise cannot keep it alive.
        // Deadline exhaustion already fails the hook; a later deletion failure must also be visible.
        void cleanupTask.catch(() => {
          if (cleanupExpired) report();
        });
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: (() => void) | undefined;
      try {
        return await Promise.race([
          cleanupTask.then(() => 'removed' as const),
          new Promise<never>((_resolve, reject) => {
            const expire = () => {
              cleanupExpired = true;
              record('fixture cleanup', 'retained');
              reject(cleanupError('Retaining fixture: cleanup deadline reached with unresolved work'));
            };
            if (typeof deadline === 'number') timer = setTimeout(expire, deadline);
            else {
              abort = expire;
              deadline.addEventListener('abort', abort, { once: true });
              if (deadline.aborted) expire();
            }
          }),
        ]);
      } finally {
        clearTimeout(timer);
        if (abort && typeof deadline !== 'number') deadline.removeEventListener('abort', abort);
      }
    },
    assertIdle: () => {
      expect(activeSpans, 'Retaining fixture: recorded I/O is still live').toBe(0);
      expect(diagnostics?.health().pending ?? 0, 'Retaining fixture: diagnostics I/O is still live').toBe(0);
    },
    arm: (target: string, stage: Stage) => {
      const state: Fault = {
        target,
        stage,
        fired: false,
        active: true,
        assert: () => {
          if (state.active) {
            state.active = false;
            activeFaults--;
            faults.delete(state);
          }
          expect(
            state.fired,
            state.fired
              ? undefined
              : `Injection never fired: expected ${stage} fault; observed matching operations: ${JSON.stringify(snapshot())}`,
          ).toBe(true);
        },
      };
      activeFaults++;
      if (faults.size < capacity) faults.add(state);
      else faultOverflow++;
      latestFault = state;
      record(stage, 'fault-armed');
      return {
        fire: () => {
          state.fired = true;
          record(stage, 'fault-fired');
        },
        assert: state.assert,
      };
    },
    // Check only at the test-facing operation boundary, outside product error handling.
    checkFault: async <T>(target: string, run: () => Promise<T>) => {
      const fault = [latestFault, ...[...faults].reverse()].find(
        (fault) => fault && path.resolve(fault.target) === path.resolve(target),
      );
      let result: T;
      try {
        result = await run();
      } catch (error) {
        record('fault operation', 'error', { code: errorCode(error), fired: fault?.fired ?? false });
        // Capture the original outcome and sanitized errno before asserting fired state.
        try {
          fault?.assert();
        } catch (missed) {
          record('fault operation', 'injection-missed');
          // Keep the immediate assertion and the original failed boundary together.
          if (missed instanceof Error) {
            Object.defineProperty(missed, 'cause', { value: error, configurable: true });
            throw missed;
          }
          throw new AggregateError([error, missed], 'Injection never fired');
        }
        throw error;
      }
      fault?.assert();
      return result;
    },
  };
}

export type PersistenceLedger = ReturnType<typeof persistenceLedger>;
const bodyLedger = new AsyncLocalStorage<PersistenceLedger>();

/** Hooks select a session; the actual body keeps its session even after Vitest times out. */
export function persistenceSession() {
  const context = bodyLedger;
  const sessions = new WeakMap<TestContext['task'], PersistenceLedger>();
  let current: PersistenceLedger;
  const ledger = () => context.getStore() ?? current;
  return {
    ledger,
    start: (test: TestContext) => {
      current = persistenceLedger();
      sessions.set(test.task, current);
    },
    cleanup: (test: TestContext) => {
      const owner = sessions.get(test.task)!;
      // Vitest aborts this public signal at its actual hook/test deadline (including overrides).
      // No separate timer may turn finite work inside the runner's allowance into a failure.
      return owner.cleanup(test.signal);
    },
    run: <T>(owner: PersistenceLedger, body: () => T) => context.run(owner, body),
    it: persistenceTest(ledger, (owner, body) => context.run(owner, body)),
  };
}

/** Keep the actual body promise visible after Vitest's timeout wrapper has returned. */
export function persistenceTest(
  readLedger: () => PersistenceLedger,
  run: (owner: PersistenceLedger, body: () => Promise<unknown>) => Promise<unknown> = (_owner, body) =>
    body(),
): typeof vitestIt {
  const wrap = (test: typeof vitestIt): typeof vitestIt =>
    new Proxy(test, {
      apply(register, receiver, args: unknown[]) {
        const index = args.findIndex((arg) => typeof arg === 'function');
        const body = args[index];
        if (typeof body === 'function')
          args[index] = function (this: unknown, ...values: unknown[]) {
            const owner = readLedger();
            return run(owner, () => owner.span('test body', async () => Reflect.apply(body, this, values)));
          };
        return Reflect.apply(register, receiver, args);
      },
      get(register, key, receiver) {
        if (key === 'each')
          return (...cases: unknown[]) => wrap(Reflect.apply(register.each, register, cases));
        return Reflect.get(register, key, receiver);
      },
    });
  return wrap(vitestIt);
}

/** Observe the entire flush; lifetime wrappers must survive mock restoration after a timeout. */
export function trackWatch(ledger: PersistenceLedger, manager: object) {
  const watched = manager as {
    flush: (state: unknown) => Promise<void>;
    start: (projectPath: string) => Promise<unknown>;
    stopAll: () => void;
  };
  const flush = watched.flush.bind(manager);
  const start = watched.start.bind(manager);
  watched.flush = (state) => ledger.span('watch flush', () => flush(state));
  watched.start = (projectPath) =>
    ledger.span('watch start lifetime', async () => {
      if (ledger.isClosing()) throw new Error('Fixture watch is closing');
      try {
        return await start(projectPath);
      } finally {
        if (ledger.isClosing()) watched.stopAll();
      }
    });
}

// Preserve the original literal matching and global renamed flag. Observation must not fix injection.
export function persistenceFault(
  ledger: PersistenceLedger,
  target: string,
  stage: Stage,
  code: string,
  options: { persistent?: boolean; requireDirectory?: boolean } = {},
) {
  if (ledger.isClosing() || bodyLedger.getStore()?.isClosing())
    throw new Error('Cannot install a persistence fault from a closing session');
  if (platform === 'win32') Object.defineProperty(process, 'platform', { value: 'linux' });
  const fault = ledger.arm(target, stage);
  let renamed = false;
  let failed = false;
  const failure = () => {
    failed = true;
    fault.fire();
    return Object.assign(new Error(code), { code });
  };
  const observe = <T>(operation: string, name: string, run: () => Promise<T>) => {
    const normalized = path.resolve(name);
    const normalizedTarget = path.resolve(target);
    const candidate = name.includes('.tmp-');
    const matches = (name: string, target: string) =>
      operation === 'rename'
        ? name === target
        : candidate
          ? name.startsWith(`${target}.tmp-`)
          : name === path.dirname(target);
    const label =
      normalized === path.dirname(normalizedTarget)
        ? 'directory'
        : normalized === normalizedTarget
          ? 'target'
          : normalized.startsWith(`${normalizedTarget}.tmp-`)
            ? 'target/candidate'
            : candidate
              ? 'sibling/candidate'
              : name.endsWith('.jsonl')
                ? 'diagnostics'
                : 'other';
    // A timed-out body can encounter a later test's global fs spy. Attribute its I/O
    // to the actual body lifetime, while preserving this spy's literal fault matching.
    return (bodyLedger.getStore() ?? ledger).span(`${label} ${operation}`, run, {
      rawMatch: matches(name, target),
      normalizedMatch: matches(normalized, normalizedTarget),
    });
  };
  vi.spyOn(fs, 'rename').mockImplementation(async (...args) =>
    observe('rename', String(args[1]), async () => {
      if (String(args[1]) === target && stage === 'rename' && !failed) throw failure();
      await realRename(...args);
      if (String(args[1]) === target) renamed = true;
    }),
  );
  vi.spyOn(fs, 'open').mockImplementation(async (...args) =>
    observe('open', String(args[0]), async () => {
      const name = String(args[0]);
      const directory = args[1] === 'r' && (await fs.stat(name)).isDirectory();
      const handle =
        directory && platform === 'win32'
          ? ({ sync: async () => undefined, close: async () => undefined } as Awaited<
              ReturnType<typeof fs.open>
            >)
          : await realOpen(...args);
      const sync = handle.sync.bind(handle);
      const close = handle.close.bind(handle);
      handle.sync = () =>
        observe('sync', name, async () => {
          if (
            (!failed || options.persistent) &&
            ((stage === 'candidate' && name.startsWith(`${target}.tmp-`)) ||
              (stage === 'directory' &&
                renamed &&
                (!options.requireDirectory || directory) &&
                name === path.dirname(target)))
          )
            throw failure();
          await sync();
        });
      handle.close = () => observe('close', name, close);
      return handle;
    }),
  );
  return fault.assert;
}
