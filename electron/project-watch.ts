import fs, { type FSWatcher } from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ProjectRevisionSnapshot,
  ProjectWatchEvent,
  ProjectWatchGrant,
} from '../src/shared/workflow-bridge.js';
import type { ProjectData } from '../src/shared/types.js';
import { NativeWorkflowError } from './workflow-errors.js';

const WATCH_DEBOUNCE_MS = 180;

interface WatchHandle {
  close(): void;
  on(event: 'error', listener: (error: Error) => void): void;
}

export interface ProjectWatchDependencies {
  createWatch(
    projectPath: string,
    listener: (eventType: string, filename: string | Buffer | null) => void,
  ): WatchHandle;
  readProjectSource(projectPath: string): Promise<string>;
  loadSnapshot(projectPath: string): Promise<ProjectRevisionSnapshot['snapshot']>;
  saveProject(projectPath: string, project: ProjectData): Promise<ProjectRevisionSnapshot['snapshot']>;
  emit(event: ProjectWatchEvent): void;
  randomId(): string;
  schedule(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  cancelSchedule(timer: ReturnType<typeof setTimeout>): void;
}

interface WatchState {
  watchId: string;
  projectPath: string;
  projectRevision: string;
  watcher: WatchHandle;
  changedPaths: Set<string>;
  selfFileRevisions: Map<string, string | null>;
  timer?: ReturnType<typeof setTimeout>;
}

export function projectRevisionForSource(source: string | Uint8Array): string {
  return createHash('sha256').update(source).digest('hex');
}

function normalizedRelativePath(filename: string | Buffer | null): string {
  if (!filename) return 'project.json';
  return filename.toString().replaceAll('\\', '/').replace(/^\.\//, '');
}

export function ignoredProjectWatchPath(relativePath: string): boolean {
  const parts = relativePath.toLowerCase().split('/');
  const basename = parts.at(-1) ?? '';
  return (
    parts.includes('exports') ||
    parts.includes('.imnota-undo') ||
    parts.includes('.imnota-transactions') ||
    basename === '.imnota-recovery.json' ||
    basename === '.imnota-recovery-backup.json' ||
    basename.includes('.tmp-') ||
    basename.endsWith('.reservation')
  );
}

function defaultDependencies(
  dependencies: Pick<ProjectWatchDependencies, 'loadSnapshot' | 'saveProject' | 'emit'>,
): ProjectWatchDependencies {
  return {
    ...dependencies,
    createWatch: (projectPath, listener) => fs.watch(projectPath, { recursive: true }, listener) as FSWatcher,
    readProjectSource: (projectPath) => fsPromises.readFile(path.join(projectPath, 'project.json'), 'utf8'),
    randomId: () => randomUUID(),
    schedule: (callback, milliseconds) => setTimeout(callback, milliseconds),
    cancelSchedule: (timer) => clearTimeout(timer),
  };
}

export class ProjectWatchManager {
  private readonly watches = new Map<string, WatchState>();
  private readonly dependencies: ProjectWatchDependencies;

  constructor(
    dependencies: Pick<ProjectWatchDependencies, 'loadSnapshot' | 'saveProject' | 'emit'> &
      Partial<Omit<ProjectWatchDependencies, 'loadSnapshot' | 'saveProject' | 'emit'>>,
  ) {
    this.dependencies = { ...defaultDependencies(dependencies), ...dependencies };
  }

  async start(projectPath: string): Promise<ProjectWatchGrant> {
    const source = await this.dependencies.readProjectSource(projectPath);
    const projectRevision = projectRevisionForSource(source);
    const watchId = this.dependencies.randomId();
    if (!/^[a-zA-Z0-9_-]+$/.test(watchId) || this.watches.has(watchId))
      throw new NativeWorkflowError('watch-failure', 'Could not create a unique project watch.');
    const watcher = this.dependencies.createWatch(projectPath, (_eventType, filename) => {
      this.recordChange(watchId, normalizedRelativePath(filename));
    });
    const state: WatchState = {
      watchId,
      projectPath,
      projectRevision,
      watcher,
      changedPaths: new Set(),
      selfFileRevisions: new Map(),
    };
    watcher.on('error', (error) => {
      this.dependencies.emit({
        watchId,
        projectPath,
        kind: 'watch-error',
        changedPaths: [],
        message: error.message,
      });
    });
    this.watches.set(watchId, state);
    return { watchId, projectPath, projectRevision };
  }

  stop(watchId: string): void {
    const state = this.state(watchId);
    if (state.timer) this.dependencies.cancelSchedule(state.timer);
    state.watcher.close();
    this.watches.delete(watchId);
  }

  stopAll(): void {
    for (const watchId of [...this.watches.keys()]) this.stop(watchId);
  }

  async reload(watchId: string): Promise<ProjectRevisionSnapshot> {
    const state = this.state(watchId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.dependencies.readProjectSource(state.projectPath);
      const snapshot = await this.dependencies.loadSnapshot(state.projectPath);
      const after = await this.dependencies.readProjectSource(state.projectPath);
      const beforeRevision = projectRevisionForSource(before);
      const projectRevision = projectRevisionForSource(after);
      if (beforeRevision !== projectRevision) continue;
      state.projectRevision = projectRevision;
      state.changedPaths.clear();
      return { snapshot: { ...snapshot, projectRevision }, projectRevision };
    }
    throw new NativeWorkflowError(
      'project-changed',
      'The project kept changing while it was reloaded. Wait for file changes to settle and try again.',
      true,
    );
  }

  async compareAndSwap(
    watchId: string,
    expectedRevision: string,
    project: ProjectData,
  ): Promise<ProjectRevisionSnapshot> {
    const state = this.state(watchId);
    const currentRevision = projectRevisionForSource(
      await this.dependencies.readProjectSource(state.projectPath),
    );
    if (currentRevision !== expectedRevision)
      throw new NativeWorkflowError(
        'project-changed',
        'The project changed on disk. Review and reload it before saving metadata.',
        true,
        { currentRevision },
      );
    await this.dependencies.saveProject(state.projectPath, project);
    const saved = await this.reload(watchId);
    state.selfFileRevisions.set('project.json', saved.projectRevision);
    return saved;
  }

  recordSelfWrite(filePath: string, source: string | Uint8Array): void {
    const resolved = path.resolve(filePath);
    const revision = projectRevisionForSource(source);
    for (const state of this.watches.values()) {
      const relative = path.relative(state.projectPath, resolved).replaceAll('\\', '/');
      if (relative.startsWith('../') || path.isAbsolute(relative) || ignoredProjectWatchPath(relative))
        continue;
      state.selfFileRevisions.set(relative, revision);
      if (relative.toLowerCase() === 'project.json') state.projectRevision = revision;
    }
  }

  recordSelfProjectWrite(projectFilePath: string, source: string | Uint8Array): void {
    if (path.basename(projectFilePath).toLowerCase() === 'project.json')
      this.recordSelfWrite(projectFilePath, source);
  }

  recordSelfDelete(filePath: string): void {
    const resolved = path.resolve(filePath);
    for (const state of this.watches.values()) {
      const relative = path.relative(state.projectPath, resolved).replaceAll('\\', '/');
      if (relative.startsWith('../') || path.isAbsolute(relative) || ignoredProjectWatchPath(relative))
        continue;
      state.selfFileRevisions.set(relative, null);
    }
  }

  private state(watchId: string): WatchState {
    const state = this.watches.get(watchId);
    if (!state) throw new NativeWorkflowError('watch-failure', 'Project watch was not found or is closed.');
    return state;
  }

  private recordChange(watchId: string, relativePath: string): void {
    const state = this.watches.get(watchId);
    const parts = relativePath.split('/');
    if (
      !state ||
      !relativePath ||
      path.isAbsolute(relativePath) ||
      parts.includes('..') ||
      ignoredProjectWatchPath(relativePath)
    )
      return;
    state.changedPaths.add(relativePath);
    if (state.timer) this.dependencies.cancelSchedule(state.timer);
    state.timer = this.dependencies.schedule(() => void this.flush(state), WATCH_DEBOUNCE_MS);
  }

  private async flush(state: WatchState): Promise<void> {
    state.timer = undefined;
    if (!state.changedPaths.size) return;
    const changedPaths = [...state.changedPaths].sort();
    state.changedPaths.clear();
    try {
      const externalPaths: string[] = [];
      for (const relativePath of changedPaths) {
        const hasExpected = state.selfFileRevisions.has(relativePath);
        const expected = state.selfFileRevisions.get(relativePath);
        if (hasExpected) {
          const source = await fsPromises
            .readFile(path.join(state.projectPath, relativePath))
            .catch(() => null);
          if (
            (source === null && expected === null) ||
            (source !== null && expected !== null && projectRevisionForSource(source) === expected)
          )
            continue;
          state.selfFileRevisions.delete(relativePath);
        }
        const stat = await fsPromises.stat(path.join(state.projectPath, relativePath)).catch(() => null);
        if (stat?.isDirectory()) continue;
        externalPaths.push(relativePath);
      }
      if (!externalPaths.length) return;
      const revision = projectRevisionForSource(await this.dependencies.readProjectSource(state.projectPath));
      this.dependencies.emit({
        watchId: state.watchId,
        projectPath: state.projectPath,
        kind: 'external-change',
        projectRevision: revision,
        changedPaths: externalPaths,
      });
    } catch (error) {
      this.dependencies.emit({
        watchId: state.watchId,
        projectPath: state.projectPath,
        kind: 'watch-error',
        changedPaths,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
