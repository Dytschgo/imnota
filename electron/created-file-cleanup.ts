import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  CommittedWriteError,
  assertNoLinks,
  writtenFileIdentity,
  type CaptureWrittenFileIdentity,
  type WrittenFileIdentity,
  type WrittenFileEvidence,
} from './files.js';

function sameFile(a: WrittenFileIdentity, b: WrittenFileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size;
}

function sameSample(a: WrittenFileIdentity, b: WrittenFileIdentity): boolean {
  return sameFile(a, b) && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

async function removeIfUnchanged(target: string, evidence: WrittenFileEvidence): Promise<void> {
  const current = writtenFileIdentity(await fs.lstat(target, { bigint: true }));
  // Reject a different identity/size before reading. Bound reads even if a file grows.
  if (!current || !sameFile(current, evidence) || evidence.size >= BigInt(Number.MAX_SAFE_INTEGER)) return;
  await assertNoLinks(target);
  // POSIX O_NOFOLLOW also permits FIFOs: avoid blocking if one replaces the
  // validated path before open. Windows has neither flag; keep its open unchanged.
  const flags = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  const handle = await fs.open(target, fsConstants.O_RDONLY | flags);
  try {
    // writtenFileIdentity requires a regular file before any content read.
    const before = writtenFileIdentity(await handle.stat({ bigint: true }));
    if (!before || !sameSample(before, current)) return;
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    const size = Number(evidence.size);
    let bytes = 0;
    while (bytes <= size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size + 1 - bytes), bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > size) return;
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = writtenFileIdentity(await handle.stat({ bigint: true }));
    const finalPath = writtenFileIdentity(await fs.lstat(target, { bigint: true }));
    if (
      bytes === size &&
      after &&
      finalPath &&
      sameSample(before, after) &&
      sameSample(after, finalPath) &&
      hash.digest('hex') === evidence.sha256
    ) {
      // Timestamp changes across rename do not establish content ownership. A
      // foreign writer producing byte-identical content is harmless to delete.
      // No intervening I/O after these checks: Node has no conditional unlink.
      // A concurrent edit/replacement after the last read/check can still be deleted.
      await fs.unlink(target);
    }
  } finally {
    await handle.close();
  }
}

/** Roll back successful writes only while descriptor identity and content still match. */
export async function withCreatedFileCleanup<T>(
  projectFile: string,
  operation: (
    create: (target: string, write: (capture: CaptureWrittenFileIdentity) => Promise<void>) => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  const created: { path: string; identity: WrittenFileEvidence }[] = [];
  try {
    return await operation(async (target, write) => {
      const existing = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      // uniqueStoredName checks images, but a leftover sidecar can still occupy a destination.
      if (existing) throw new Error(`Screenshot destination already exists: ${target}`);
      let identity: WrittenFileEvidence | undefined;
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
          await removeIfUnchanged(entry.path, entry.identity);
        } catch {
          // Cleanup is best-effort and must preserve the original operation error.
        }
      }
    }
    throw error;
  }
}
