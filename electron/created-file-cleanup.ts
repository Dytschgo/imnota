import fs from 'node:fs/promises';
import path from 'node:path';
import { CommittedWriteError } from './files.js';

/** Track only absent destinations, including writes that create a file before rejecting. */
export async function withCreatedFileCleanup<T>(
  projectFile: string,
  operation: (create: (target: string, write: () => Promise<void>) => Promise<void>) => Promise<T>,
): Promise<T> {
  const created: string[] = [];
  try {
    return await operation(async (target, write) => {
      const existing = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      // uniqueStoredName checks images, but a leftover sidecar can still occupy a destination.
      if (existing) throw new Error(`Screenshot destination already exists: ${target}`);
      created.push(target);
      await write();
    });
  } catch (error) {
    // A replaced project already references these files, even if directory sync failed.
    if (!(
      error instanceof CommittedWriteError && path.resolve(error.filePath) === path.resolve(projectFile)
    )) {
      for (const target of created) await fs.unlink(target).catch(() => undefined);
    }
    throw error;
  }
}
