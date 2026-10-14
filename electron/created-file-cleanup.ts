import fs from 'node:fs/promises';
import path from 'node:path';
import { CommittedWriteError } from './files.js';

/** Roll back successful writes to absent destinations only while their recorded identity matches. */
export async function withCreatedFileCleanup<T>(
  projectFile: string,
  operation: (create: (target: string, write: () => Promise<void>) => Promise<void>) => Promise<T>,
): Promise<T> {
  const created: {
    path: string;
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeMs: bigint;
  }[] = [];
  try {
    return await operation(async (target, write) => {
      const existing = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      // uniqueStoredName checks images, but a leftover sidecar can still occupy a destination.
      if (existing) throw new Error(`Screenshot destination already exists: ${target}`);
      await write();
      const { dev, ino, size, mtimeMs } = await fs.lstat(target, { bigint: true });
      created.push({ path: target, dev, ino, size, mtimeMs });
    });
  } catch (error) {
    // A replaced project already references these files, even if directory sync failed.
    if (!(
      error instanceof CommittedWriteError && path.resolve(error.filePath) === path.resolve(projectFile)
    )) {
      for (const entry of created) {
        try {
          const current = await fs.lstat(entry.path, { bigint: true });
          if (
            current.dev === entry.dev &&
            current.ino === entry.ino &&
            current.size === entry.size &&
            current.mtimeMs === entry.mtimeMs
          ) {
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
