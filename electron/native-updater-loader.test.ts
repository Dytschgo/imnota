import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createNativeUpdaterLoader } from './native-updater-loader.js';

class FakeUpdater extends EventEmitter {
  // electron-updater's defaults, which must never reach an update call.
  autoDownload = true;
  autoInstallOnAppQuit = true;
}

function setup(load: () => Promise<FakeUpdater>) {
  const events = { progress: vi.fn(), error: vi.fn() };
  return { events, loader: createNativeUpdaterLoader(load, events) };
}

describe('native updater loader', () => {
  it('does not load the updater until it is first needed', () => {
    const load = vi.fn(async () => new FakeUpdater());
    const { loader } = setup(load);
    expect(load).not.toHaveBeenCalled();
    expect(loader.loaded).toBeUndefined();
  });

  it('configures and observes the updater before returning it', async () => {
    const { events, loader } = setup(async () => new FakeUpdater());
    const updater = await loader.load();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(loader.loaded).toBe(updater);
    updater.emit('download-progress', { percent: 42 });
    updater.emit('error', new Error('native install failed'));
    expect(events.progress).toHaveBeenCalledWith(42);
    expect(events.error).toHaveBeenCalledOnce();
  });

  it('loads once for concurrent and later callers', async () => {
    const load = vi.fn(async () => new FakeUpdater());
    const { loader } = setup(load);
    const [first, second] = await Promise.all([loader.load(), loader.load()]);
    expect(await loader.load()).toBe(first);
    expect(second).toBe(first);
    expect(load).toHaveBeenCalledOnce();
    expect(first.listenerCount('error')).toBe(1);
  });

  it('rejects a failed load and retries it on the next call', async () => {
    const recovered = new FakeUpdater();
    const load = vi
      .fn<() => Promise<FakeUpdater>>()
      .mockRejectedValueOnce(new Error('module missing'))
      .mockResolvedValueOnce(recovered);
    const { loader } = setup(load);
    await expect(loader.load()).rejects.toThrow('module missing');
    expect(loader.loaded).toBeUndefined();
    expect(await loader.load()).toBe(recovered);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
