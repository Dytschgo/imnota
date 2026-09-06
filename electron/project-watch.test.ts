// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWatchEvent } from '../src/shared/workflow-bridge.js';
import { emptyProject } from '../src/shared/utils.js';
import { ProjectWatchManager } from './project-watch.js';

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
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'external-change', changedPaths: ['project.json'] });
  });

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
