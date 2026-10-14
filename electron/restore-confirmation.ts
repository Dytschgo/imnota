import { RESTORE_CONFIRMATION_FAILURE } from '../src/shared/write-outcome.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectData, ProjectSnapshot } from '../src/shared/types.js';
import {
  atomicWrite,
  assertNoLinks,
  CommittedWriteError,
  readStableRegularFile,
  type StableReadHooks,
} from './files.js';
import { projectRevisionForSource } from './project-watch.js';

/** Confirmation failures keep the committed restore journal; they must never trigger rollback. */
export class RestoreConfirmationError extends Error {}

/** Capture this invocation's own writes before any snapshot can authorize journal cleanup. */
export function restoreConfirmation(
  projectPath: string,
  write: typeof atomicWrite,
  loadSnapshot: (projectPath: string) => Promise<ProjectSnapshot>,
  ownsRevision?: (projectPath: string, revision: string) => boolean,
  verificationReadHooks?: StableReadHooks,
) {
  const metadata = path.join(projectPath, 'project.json');
  const committed = new Map<string, string>();
  let writeFailure: unknown;
  let confirmed: ProjectSnapshot | undefined;
  return {
    async write(target: string, source: string | Uint8Array) {
      try {
        await write(target, source);
      } catch (error) {
        writeFailure = error;
        if (!(error instanceof CommittedWriteError) || path.resolve(error.filePath) !== path.resolve(target))
          throw error;
        committed.set(path.resolve(target), projectRevisionForSource(source));
        throw error;
      }
      committed.set(path.resolve(target), projectRevisionForSource(source));
    },
    async confirm(project: ProjectData, warning?: string) {
      const expected = projectRevisionForSource(JSON.stringify(project, null, 2));
      try {
        const own = committed.get(metadata);
        if (
          writeFailure &&
          (!own || own !== expected || (ownsRevision && !ownsRevision(projectPath, expected)))
        )
          throw new Error('The restored metadata has no matching own-write confirmation.');
        const read = async () => {
          const source = await readStableRegularFile(metadata, 20_000_000, verificationReadHooks);
          if (!source || projectRevisionForSource(source.text) !== expected)
            throw new Error('The project changed again on disk.');
        };
        await read();
        const snapshot = await loadSnapshot(projectPath);
        await read();
        if (
          snapshot.projectPath !== projectPath ||
          (snapshot.projectRevision && snapshot.projectRevision !== expected) ||
          JSON.stringify(snapshot.project) !== JSON.stringify(project)
        )
          throw new Error('The restored snapshot changed during confirmation.');
        for (const [target, revision] of committed) {
          const relative = path.relative(projectPath, target).replaceAll('\\', '/');
          if (!relative.startsWith('collections/')) continue;
          await assertNoLinks(target);
          if (projectRevisionForSource(await fs.readFile(target)) !== revision)
            throw new Error('Restored member content changed during confirmation.');
        }
        confirmed = { ...snapshot, projectRevision: expected };
      } catch (error) {
        throw new RestoreConfirmationError(
          [
            warning ?? (writeFailure instanceof Error ? writeFailure.message : undefined),
            `${RESTORE_CONFIRMATION_FAILURE} ${error instanceof Error ? error.message : String(error)}`,
            'Recovery files were preserved. Reload and compare the project before saving or restoring again.',
          ]
            .filter(Boolean)
            .join(' '),
          { cause: error },
        );
      }
    },
    snapshot(warning?: string): ProjectSnapshot {
      if (!confirmed) throw new RestoreConfirmationError('Restore did not confirm a snapshot.');
      return { ...confirmed, warnings: [...(confirmed.warnings ?? []), ...(warning ? [warning] : [])] };
    },
  };
}
