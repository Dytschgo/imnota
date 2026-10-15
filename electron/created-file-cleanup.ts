import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CommittedWriteError,
  writtenFileIdentity,
  type CaptureWrittenFileIdentity,
  type WrittenFileIdentity,
} from './files.js';

/** Roll back successful writes only while the writer's own descriptor evidence still matches. */
export async function withCreatedFileCleanup<T>(
  projectFile: string,
  operation: (
    create: (target: string, write: (capture: CaptureWrittenFileIdentity) => Promise<void>) => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  const created: { path: string; identity: WrittenFileIdentity }[] = [];
  try {
    return await operation(async (target, write) => {
      const existing = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      // uniqueStoredName checks images, but a leftover sidecar can still occupy a destination.
      if (existing) throw new Error(`Screenshot destination already exists: ${target}`);
      let identity: WrittenFileIdentity | undefined;
      await write((evidence) => {
        identity = evidence;
      });
      // A writer without evidence (or a rejected write) never authorizes deletion.
      if (identity) created.push({ path: target, identity });
    });
  } catch (error) {
    // A replaced project already references these files, even if directory sync failed.
    if (!(
      error instanceof CommittedWriteError && path.resolve(error.filePath) === path.resolve(projectFile)
    )) {
      for (const entry of created) {
        try {
          const current = writtenFileIdentity(await fs.lstat(entry.path, { bigint: true }));
          if (
            current &&
            current.dev === entry.identity.dev &&
            current.ino === entry.identity.ino &&
            current.size === entry.identity.size &&
            current.mtimeNs === entry.identity.mtimeNs &&
            current.ctimeNs === entry.identity.ctimeNs
          ) {
            // No intervening I/O: Node has no portable compare-and-unlink. Another
            // process can still replace/edit this path between lstat and unlink.
            await fs.unlink(entry.path);
          }
        } catch {
          // Cleanup is best-effort and must preserve the original operation error.
        }
      }
    }
    throw error;
  }
}
