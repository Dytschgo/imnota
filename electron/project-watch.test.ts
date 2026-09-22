// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWatchEvent } from '../src/shared/workflow-bridge.js';
import { emptyProject } from '../src/shared/utils.js';
import { ignoredProjectWatchPath, ProjectWatchManager, projectRevisionForSource } from './project-watch.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((item) => fs.rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const projectPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-watch-')));
  temporary.push(projectPath);
  const project = emptyProject('Watch', '');
  const projectFile = path.join(projectPath, 'project.json');
  await fs.writeFile(projectFile, JSON.stringify(project));
  let listener: (eventType: string, filename: string | Buffer | null) => void = () => undefined;
  const close = vi.fn();
  const events: ProjectWatchEvent[] = [];
  const manager = new ProjectWatchManager({
    randomId: () => 'watch-grant',
    createWatch: (_target, nextListener) => {
      listener = nextListener;
      return { close, on: vi.fn() };
    },
    loadSnapshot: async () => ({
      projectPath,
      project,
      thumbnails: {},
      recoveryFound: false,
    }),
    saveProject: async (_target, next) => {
      await fs.writeFile(projectFile, JSON.stringify(next));
      return { projectPath, project: next, thumbnails: {}, recoveryFound: false };
    },
    emit: (event) => events.push(event),
  });
  return { manager, projectPath, projectFile, project, listener: () => listener, events, close };
}

describe('project file watch and compare-and-swap', () => {
  it('ignores internal export, trash, recovery, and screenshot transaction paths', () => {
    expect(ignoredProjectWatchPath('collections/001/exports/set/prompt.png')).toBe(true);
    expect(ignoredProjectWatchPath('.imnota-undo/token/manifest.json')).toBe(true);
    expect(ignoredProjectWatchPath('.imnota-transactions/txn-token/after-0001.bin')).toBe(true);
    expect(ignoredProjectWatchPath('.imnota-recovery.json')).toBe(true);
    expect(ignoredProjectWatchPath('collections/001/annotations/screenshot.json')).toBe(false);
  });

  it('debounces external changes while ignoring exports and known self revisions', async () => {
    const { manager, projectPath, projectFile, listener, events } = await fixture();
    await manager.start(projectPath);
    listener()('rename', 'collections/001/exports/prompt.png');
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(events).toEqual([]);

    const ownSource = JSON.stringify({ marker: 'self' });
    await fs.writeFile(projectFile, ownSource);
    manager.recordSelfProjectWrite(projectFile, ownSource);
    listener()('change', 'project.json');
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(events).toEqual([]);

    await fs.writeFile(projectFile, JSON.stringify({ marker: 'external' }));
    listener()('change', 'project.json');
    listener()('change', 'project.json');
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 2_000, interval: 25 });
    expect(events[0]).toMatchObject({ kind: 'external-change', changedPaths: ['project.json'] });
    manager.stopAll();
  });

  it.each(['latest bytes', 'stale bytes'] as const)(
    'does not misclassify a self write that advances during a read returning %s',
    async (readResult) => {
      const projectPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-watch-race-')));
      temporary.push(projectPath);
      const projectFile = path.join(projectPath, 'project.json');
      await fs.writeFile(projectFile, JSON.stringify(emptyProject('Watch', '')));
      const callbacks: Array<{ run: () => void; timer: ReturnType<typeof setTimeout> }> = [];
      let listener: (eventType: string, filename: string | Buffer | null) => void = () => undefined;
      let releaseRead!: () => void;
      const readGate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let readStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        readStarted = resolve;
      });
      let firstReadCompleted!: () => void;
      const firstRead = new Promise<void>((resolve) => {
        firstReadCompleted = resolve;
      });
      let secondReadCompleted!: () => void;
      const secondRead = new Promise<void>((resolve) => {
        secondReadCompleted = resolve;
      });
      let reads = 0;
      let first = '';
      const events: ProjectWatchEvent[] = [];
      const project = emptyProject('Watch', '');
      const manager = new ProjectWatchManager({
        randomId: () => 'race-watch',
        createWatch: (_target, callback) => {
          listener = callback;
          return { close: vi.fn(), on: vi.fn() };
        },
        readWatchedFile: async (filePath) => {
          reads++;
          if (reads === 1) {
            readStarted();
            await readGate;
          }
          const source =
            reads === 1 && readResult === 'stale bytes'
              ? Buffer.from(first)
              : await fs.readFile(filePath).catch(() => null);
          if (reads === 1) firstReadCompleted();
          if (reads === 2) secondReadCompleted();
          return source;
        },
        schedule: (run) => {
          const timer = setTimeout(() => undefined, 60_000);
          callbacks.push({ run, timer });
          return timer;
        },
        cancelSchedule: (timer) => clearTimeout(timer),
        loadSnapshot: async () => ({ projectPath, project, thumbnails: {}, recoveryFound: false }),
        saveProject: async () => ({ projectPath, project, thumbnails: {}, recoveryFound: false }),
        emit: (event) => events.push(event),
      });
      await manager.start(projectPath);
      first = JSON.stringify({ revision: 'first self write' });
      await fs.writeFile(projectFile, first);
      manager.recordSelfWrite(projectFile, first);
      listener('change', 'project.json');
      const firstFlush = callbacks.shift()!;
      clearTimeout(firstFlush.timer);
      firstFlush.run();
      await started;

      const second = JSON.stringify({ revision: 'second self write' });
      await fs.writeFile(projectFile, second);
      manager.recordSelfWrite(projectFile, second);
      releaseRead();
      await firstRead;
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (readResult === 'stale bytes') {
        const recheck = callbacks.shift();
        expect(recheck).toBeDefined();
        clearTimeout(recheck!.timer);
        recheck!.run();
        await secondRead;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(events).toEqual([]);

      const external = JSON.stringify({ revision: 'external edit' });
      await fs.writeFile(projectFile, external);
      listener('change', 'project.json');
      const externalFlush = callbacks.shift()!;
      clearTimeout(externalFlush.timer);
      externalFlush.run();
      await vi.waitFor(() =>
        expect(events.filter((event) => event.kind === 'external-change')).toHaveLength(1),
      );
      expect(events[0]).toMatchObject({
        kind: 'external-change',
        projectRevision: projectRevisionForSource(external),
        changedPaths: ['project.json'],
      });
      manager.stopAll();
    },
  );

  it('rejects stale CAS and returns a fresh revision after a successful save', async () => {
    const { manager, projectPath, projectFile, project } = await fixture();
    const grant = await manager.start(projectPath);
    await fs.writeFile(projectFile, JSON.stringify({ external: true }));
    await expect(manager.compareAndSwap(grant.watchId, grant.projectRevision, project)).rejects.toMatchObject(
      {
        code: 'project-changed',
        retryable: true,
      },
    );

    const reloaded = await manager.reload(grant.watchId);
    const successful = await manager.compareAndSwap(grant.watchId, reloaded.projectRevision, project);
    expect(successful.projectRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(successful.snapshot.projectRevision).toBe(successful.projectRevision);
  });

  it('retries reload rather than pairing an older snapshot with a newer revision', async () => {
    const projectPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-watch-race-')));
    temporary.push(projectPath);
    const first = JSON.stringify({ revision: 'first' });
    const second = JSON.stringify({ revision: 'second' });
    const sources = [first, first, second, second, second];
    let snapshots = 0;
    const project = emptyProject('Stable', '');
    const manager = new ProjectWatchManager({
      randomId: () => 'race-watch',
      createWatch: () => ({ close: vi.fn(), on: vi.fn() }),
      readProjectSource: async () => sources.shift() ?? second,
      loadSnapshot: async () => {
        snapshots++;
        return { projectPath, project, thumbnails: {}, recoveryFound: false };
      },
      saveProject: async () => ({ projectPath, project, thumbnails: {}, recoveryFound: false }),
      emit: vi.fn(),
    });
    const grant = await manager.start(projectPath);
    expect(grant.projectRevision).toMatch(/^[a-f0-9]{64}$/);
    const reloaded = await manager.reload(grant.watchId);
    expect(snapshots).toBe(2);
    expect(reloaded.projectRevision).toMatch(/^[a-f0-9]{64}$/);
  });
});
