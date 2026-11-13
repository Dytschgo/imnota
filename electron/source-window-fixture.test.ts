// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Script } from 'node:vm';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { sourceWindowFixtureTitle, withSourceWindowFixture } from './source-window-fixture.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  ['0', 'synthetic'],
  ['1', 'real'],
  ['1', ''],
])('never launches a fixture outside isolated synthetic verification (%s/%s)', async (smoke, source) => {
  vi.stubEnv('IMNOTA_SMOKE', smoke);
  vi.stubEnv('IMNOTA_SMOKE_CAPTURE_SOURCE', source);
  const launch = vi.fn();
  await expect(withSourceWindowFixture(async () => undefined, launch)).rejects.toThrow('requires isolated');
  expect(launch).not.toHaveBeenCalled();
  expect(sourceWindowFixtureTitle()).toBeNull();
});

it.each(['win32', 'darwin'])(
  'revokes the marker and confirms closure of only its own child when the %s walkthrough fails',
  async (platform) => {
    vi.stubEnv('IMNOTA_SMOKE', '1');
    vi.stubEnv('IMNOTA_SMOKE_CAPTURE_SOURCE', 'synthetic');
    vi.stubGlobal('process', Object.create(process, { platform: { value: platform } }));
    const events = new EventEmitter();
    const kill = vi.fn(() => {
      events.emit('close', null, 'SIGTERM');
      return true;
    });
    const child = Object.assign(events, {
      pid: 12345,
      exitCode: null,
      signalCode: null,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill,
    }) as unknown as ChildProcess;
    const launch = vi.fn((_command: string, args: string[]) => {
      // Syntax coverage only; the hosted Mac walkthrough must still execute AppKit and WindowServer.
      if (platform === 'darwin') new Script(args[3]);
      queueMicrotask(() => events.emit('spawn'));
      return child;
    });
    const original = new Error('capture did not reach its postcondition');
    await expect(
      withSourceWindowFixture(async (title) => {
        expect(sourceWindowFixtureTitle()).toBe(title);
        await expect(withSourceWindowFixture(async () => undefined, launch)).rejects.toThrow(
          'already active',
        );
        throw original;
      }, launch),
    ).rejects.toBe(original);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledExactlyOnceWith();
    expect(sourceWindowFixtureTitle()).toBeNull();
  },
);

it('retains the failed postcondition with bounded owned-child diagnostics and confirms cleanup', async () => {
  vi.stubEnv('IMNOTA_SMOKE', '1');
  vi.stubEnv('IMNOTA_SMOKE_CAPTURE_SOURCE', 'synthetic');
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }));
  const events = new EventEmitter();
  const stderr = new PassThrough();
  const kill = vi.fn(() => {
    events.emit('close', null, 'SIGTERM');
    return true;
  });
  const child = Object.assign(events, {
    pid: 12345,
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr,
    kill,
  }) as unknown as ChildProcess;
  const original = new Error('The OS did not identify the owned native source fixture.');
  const result = withSourceWindowFixture(
    async () => {
      stderr.write('discarded prefix' + 'x'.repeat(2500) + 'owned-window-visible');
      throw original;
    },
    () => {
      queueMicrotask(() => events.emit('spawn'));
      return child;
    },
  );
  await expect(result).rejects.toMatchObject({ cause: original });
  await expect(result).rejects.toThrow(original.message);
  await expect(result).rejects.toThrow('owned-window-visible');
  await expect(result).rejects.not.toThrow('discarded prefix');
  expect(kill).toHaveBeenCalledExactlyOnceWith();
  expect(sourceWindowFixtureTitle()).toBeNull();
});
