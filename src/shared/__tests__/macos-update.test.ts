// @vitest-environment node
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MacUpdateSession, startMacUpdate } from '../../../electron/macos-update.js';
import { UpdateFailure } from '../../../electron/update-controller.js';

const spawned = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args: string[]; child: unknown }>,
}));
vi.mock('node:child_process', async (importOriginal) => {
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    ...(await importOriginal<typeof import('node:child_process')>()),
    spawn: vi.fn((command: string, args: string[]) => {
      const child = Object.assign(new Emitter(), { exitCode: null, unref: vi.fn(), kill: vi.fn(() => true) });
      spawned.calls.push({ command, args, child });
      return child;
    }),
  };
});

const version = '0.4.1-nightly.20261002.37064937780';
const base = `https://github.com/Dytschgo/imnota/releases/download/v${version}/`;
const release = {
  version,
  url: base,
  feedUrl: base,
  assetUrls: [`${base}Imnota-${version}-universal-mac.zip`],
  checksumUrl: `${base}SHA256SUMS.txt`,
};

function session(signal = vi.fn(() => true)) {
  const events = { progress: vi.fn(), failed: vi.fn() };
  return { events, signal, instance: new MacUpdateSession(signal, events) };
}

describe('in-app macOS updates', () => {
  it('reports archive progress across split chunks and resolves once the helper is verified', async () => {
    const { instance, events } = session();
    instance.consume('Downloading Imnota 1.2.3...\r##### 100.0%\n');
    expect(events.progress).not.toHaveBeenCalled();
    instance.consume('IMNOTA_UPDATE arch');
    instance.consume('ive\r###   12.5%\r######  4');
    expect(events.progress).toHaveBeenLastCalledWith(12.5);
    instance.consume('8.0%\r');
    expect(events.progress).toHaveBeenLastCalledWith(48);
    instance.consume('\nIMNOTA_UPDATE ready\n');
    await expect(instance.ready).resolves.toBeUndefined();
    expect(events.progress).toHaveBeenLastCalledWith(100);
  });

  it("rejects the download with the helper's own reason when it stops before verification", async () => {
    const { instance, events } = session();
    instance.consume('IMNOTA_UPDATE archive\n#### 30.0%\r');
    instance.exited(1, 'Update failed: The downloaded zip does not match SHA256SUMS.txt.\n');
    const failure = await instance.ready.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UpdateFailure);
    expect((failure as Error).message).toBe('The downloaded zip does not match SHA256SUMS.txt.');
    expect(events.failed).not.toHaveBeenCalled();
  });

  it('requests installation once and treats a clean exit after it as installed', async () => {
    const { instance, events, signal } = session();
    instance.consume('IMNOTA_UPDATE ready\n');
    await instance.ready;
    instance.install();
    expect(signal).toHaveBeenCalledWith('SIGUSR1');
    expect(() => instance.install()).toThrow();
    instance.exited(0);
    expect(events.failed).not.toHaveBeenCalled();
  });

  it('reports a ready update as lost when the helper stops or installation fails', async () => {
    const waiting = session();
    waiting.instance.consume('IMNOTA_UPDATE ready\n');
    waiting.instance.exited(0);
    expect(waiting.events.failed).toHaveBeenCalledWith(expect.stringMatching(/helper stopped/));
    expect(() => waiting.instance.install()).toThrow();

    const installing = session();
    installing.instance.consume('IMNOTA_UPDATE ready\n');
    installing.instance.install();
    installing.instance.exited(1, 'Update failed: Imnota did not quit within 60 seconds.\n');
    expect(installing.events.failed).toHaveBeenCalledWith('Imnota did not quit within 60 seconds.');
  });

  it('marks a helper that exits right after verifying as finished, not installable', async () => {
    const { instance } = session();
    instance.exited(0, 'IMNOTA_UPDATE ready\n');
    await expect(instance.ready).resolves.toBeUndefined();
    expect(instance.finished).toBe(true);
    expect(instance.failureMessage).toMatch(/helper stopped/);
    expect(() => instance.install()).toThrow();
  });

  it('starts a detached helper for this Imnota process and reports its final reason before cleanup', async () => {
    const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-mac-update-test-'));
    const helperPath = path.join(cache, 'bundled-update-macos.sh');
    await fs.writeFile(helperPath, '#!/bin/bash\n');
    const events = { progress: vi.fn(), failed: vi.fn() };
    try {
      const started = await startMacUpdate(
        release,
        {
          appPath: '/Applications/Imnota.app',
          appPid: 4321,
          helperPath,
          cachePath: cache,
          currentVersion: '0.4.0',
        },
        events,
        5,
      );
      const { command, args, child } = spawned.calls.at(-1)!;
      expect(command).toBe('/bin/bash');
      expect(args.slice(1)).toEqual([
        '--in-app',
        '4321',
        `v${version}`,
        release.assetUrls[0],
        release.checksumUrl,
        '/Applications/Imnota.app',
        '0.4.0',
      ]);
      const directory = path.dirname(args[0]);
      expect(path.dirname(directory)).toBe(cache);
      const log = path.join(directory, 'update.log');
      await fs.appendFile(log, 'IMNOTA_UPDATE archive\n## 40.0%\r');
      await vi.waitFor(() => expect(events.progress).toHaveBeenLastCalledWith(40));
      await fs.appendFile(log, '\nUpdate failed: The downloaded zip does not match SHA256SUMS.txt.\n');
      (child as EventEmitter).emit('exit', 1);
      await expect(started.ready).rejects.toThrow('does not match SHA256SUMS.txt');
      await vi.waitFor(async () => expect(await fs.readdir(cache)).toEqual(['bundled-update-macos.sh']));
    } finally {
      await fs.rm(cache, { recursive: true, force: true });
    }
  });

  it('refuses installation when the helper can no longer be signalled', async () => {
    const { instance } = session(vi.fn(() => false));
    instance.consume('IMNOTA_UPDATE ready\n');
    expect(() => instance.install()).toThrow(/no longer running/);
  });
});
