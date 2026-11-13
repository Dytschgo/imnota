// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { sourceWindowFixtureTitle, withSourceWindowFixture } from './source-window-fixture.js';

afterEach(() => vi.unstubAllEnvs());

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

it.skipIf(!['win32', 'darwin'].includes(process.platform))(
  'revokes the marker and confirms closure of only its own child when the walkthrough fails',
  async () => {
    vi.stubEnv('IMNOTA_SMOKE', '1');
    vi.stubEnv('IMNOTA_SMOKE_CAPTURE_SOURCE', 'synthetic');
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
    const launch = vi.fn(() => {
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
