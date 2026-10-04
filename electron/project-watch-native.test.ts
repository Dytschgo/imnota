// @vitest-environment node
import nodeFs, { type FSWatcher, type PathLike, type WatchOptions, type WatchListener } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectWatchManager, projectRevisionForSource } from './project-watch.js';
import { emptyProject } from '../src/shared/utils.js';
import type { ProjectWatchEvent } from '../src/shared/workflow-bridge.js';

const platform = process.platform;
const realWatch = nodeFs.watch.bind(nodeFs);
const roots: string[] = [];
const stops: Array<() => void> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', { value: platform });
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it.each([false, true])(
  'detects foreign metadata after replacement with a stale recursive subscription (read in flight: %s)',
  async (holdRead) => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-watch-native-')));
    roots.push(root);
    const file = path.join(root, 'project.json');
    const project = emptyProject('Watch', '');
    await fs.writeFile(file, JSON.stringify(project));
    // Model an inode-bound recursive subscription that cannot report the replacement.
    // The supplemental directory subscription and every file operation stay real.
    const recursive = Object.assign(new EventEmitter(), { close: vi.fn() });
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.spyOn(nodeFs, 'watch').mockImplementation(((
      target: PathLike,
      options: WatchOptions,
      listener: WatchListener<string | Buffer>,
    ) =>
      typeof options === 'object' && options?.recursive
        ? (recursive.on('change', listener!) as unknown as FSWatcher)
        : realWatch(target, options ?? {}, listener!)) as typeof nodeFs.watch);
    const own = JSON.stringify({ ...project, name: 'Restored' });
    const completedReads: string[] = [];
    let hold = false;
    let reading = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: ProjectWatchEvent[] = [];
    const manager = new ProjectWatchManager({
      loadSnapshot: async () => ({ projectPath: root, project, thumbnails: {}, recoveryFound: false }),
      saveProject: async () => {
        throw new Error('Unexpected save');
      },
      emit: (event) => events.push(event),
      readWatchedFile: async (target) => {
        const bytes = await fs.readFile(target);
        if (hold) {
          hold = false;
          reading = true;
          await gate;
        }
        completedReads.push(bytes.toString());
        return bytes;
      },
    });
    stops.push(() => manager.stopAll());
    await manager.start(root);
    const candidate = path.join(root, 'project.json.tmp-fixture');
    await fs.writeFile(candidate, own);
    await fs.rename(candidate, file);
    manager.recordSelfWrite(file, own);
    recursive.emit('change', 'rename', 'project.json');
    await vi.waitFor(() => expect(completedReads).toContain(own));
    expect(events).toEqual([]);
    if (holdRead) {
      hold = true;
      await fs.writeFile(file, own);
      await vi.waitFor(() => expect(reading).toBe(true));
    }
    const foreign = JSON.stringify({ ...project, name: 'Restored', favourite: true });
    await fs.writeFile(file, foreign);
    release();
    await vi.waitFor(() => expect(events.some((event) => event.kind === 'external-change')).toBe(true));
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'external-change',
        changedPaths: ['project.json'],
        projectRevision: projectRevisionForSource(foreign),
      }),
    );
    expect(await fs.readFile(file, 'utf8')).toBe(foreign);
    expect(recursive.close).not.toHaveBeenCalled();
  },
);

it.each(['directory watch fails', 'both watches start'] as const)(
  'releases watch resources and forwards errors when %s',
  async (outcome) => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const recursive = Object.assign(new EventEmitter(), { close: vi.fn() });
    const metadata = Object.assign(new EventEmitter(), { close: vi.fn() });
    const failure = new Error('Directory watch unavailable');
    vi.spyOn(nodeFs, 'watch').mockImplementation(((_target, options) => {
      if (typeof options === 'object' && options?.recursive) return recursive as unknown as FSWatcher;
      if (outcome === 'directory watch fails') throw failure;
      return metadata as unknown as FSWatcher;
    }) as typeof nodeFs.watch);
    const events: ProjectWatchEvent[] = [];
    const manager = new ProjectWatchManager({
      readProjectSource: async () => '{}',
      loadSnapshot: async () => {
        throw new Error('Unexpected load');
      },
      saveProject: async () => {
        throw new Error('Unexpected save');
      },
      emit: (event) => events.push(event),
    });
    stops.push(() => manager.stopAll());
    if (outcome === 'directory watch fails') {
      await expect(manager.start(path.resolve('synthetic-watch'))).rejects.toBe(failure);
      expect(recursive.close).toHaveBeenCalledOnce();
      expect(metadata.close).not.toHaveBeenCalled();
    } else {
      await manager.start(path.resolve('synthetic-watch'));
      recursive.emit('error', new Error('Recursive unavailable'));
      metadata.emit('error', failure);
      expect(events.map((event) => [event.kind, event.message])).toEqual([
        ['watch-error', 'Recursive unavailable'],
        ['watch-error', 'Directory watch unavailable'],
      ]);
      manager.stopAll();
      expect(recursive.close).toHaveBeenCalledOnce();
      expect(metadata.close).toHaveBeenCalledOnce();
    }
  },
);
