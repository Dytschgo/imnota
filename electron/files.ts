import { COMMITTED_WRITE_WARNING } from '../src/shared/write-outcome.js';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

// Refuse junctions and symlinks, including in existing ancestors of a new file.
export async function assertNoLinks(target: string): Promise<void> {
  let current = path.resolve(target);
  while (true) {
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isSymbolicLink())
      throw new Error('Linked workspace paths are not supported. Choose a regular folder.');
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/** The file is not a regular file within the byte limit, or grew while it was read. */
export class FileReadLimitError extends Error {}

export interface StableReadHooks {
  /** Test seams used to prove that path replacement between validation and open is rejected. */
  beforeOpen?(target: string): Promise<void>;
  afterOpen?(target: string): Promise<void>;
}

const utf8 = new TextDecoder('utf-8', { fatal: false });

/**
 * Read a regular, unlinked file without following links and reject it if the path is
 * replaced or the file changes while it is read. A growing file cannot expand the
 * allocation. Returns null when the file does not exist.
 */
export async function readStableRegularFile(
  target: string,
  maximumBytes: number,
  hooks: StableReadHooks = {},
): Promise<{ text: string; bytes: number } | null> {
  const buffer = await readStableRegularFileBytes(target, maximumBytes, hooks);
  return buffer === null ? null : { text: utf8.decode(buffer), bytes: buffer.length };
}

/** Binary counterpart with the same exact identity, time, size and handle-cleanup checks. */
export async function readStableRegularFileBytes(
  target: string,
  maximumBytes: number,
  hooks: StableReadHooks = {},
): Promise<Buffer | null> {
  // Leave room for the growth sentinel and reject unsafe caller bounds before I/O.
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes >= Number.MAX_SAFE_INTEGER)
    throw new FileReadLimitError('The read limit must be a nonnegative safe byte count.');
  const maximum = BigInt(maximumBytes);
  await assertNoLinks(target);
  await hooks.beforeOpen?.(target);
  const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW;
  const handle = await fs
    .open(target, fsConstants.O_RDONLY | noFollow)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  if (!handle) return null;
  try {
    await hooks.afterOpen?.(target);
    await assertNoLinks(target);
    const stat = await handle.stat({ bigint: true });
    const pathStat = await fs.lstat(target, { bigint: true });
    if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino)
      throw new Error('A file path changed while it was opened.');
    if (!stat.isFile() || stat.size < 0n || stat.size > maximum)
      throw new FileReadLimitError('The file exceeds the read limit.');
    // Convert only after the exact size is within the validated, safely representable bound.
    const size = Number(stat.size);
    const buffer = Buffer.alloc(size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const { bytesRead } = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
    }
    if (bytes > size) throw new FileReadLimitError('The file grew beyond its read limit while it was read.');
    await assertNoLinks(target);
    const finalPath = await fs.lstat(target, { bigint: true });
    const finalHandle = await handle.stat({ bigint: true });
    if (
      bytes !== size ||
      finalPath.isSymbolicLink() ||
      stat.dev !== finalPath.dev ||
      stat.ino !== finalPath.ino ||
      stat.size !== finalHandle.size ||
      stat.mtimeNs !== finalHandle.mtimeNs ||
      stat.ctimeNs !== finalHandle.ctimeNs
    )
      throw new Error('A file changed while it was read.');
    return buffer.subarray(0, bytes);
  } finally {
    await handle.close();
  }
}

/** Only the named file has committed; this does not commit an enclosing transaction. */
export class CommittedWriteError extends Error {
  readonly committed = true;
  readonly code: string | undefined;
  constructor(
    readonly filePath: string,
    cause: unknown,
  ) {
    super(
      `${COMMITTED_WRITE_WARNING} The overall operation may be incomplete. Reload and review the current state before retrying.`,
      { cause },
    );
    this.name = 'CommittedWriteError';
    this.code = (cause as NodeJS.ErrnoException | undefined)?.code;
  }
}

/** Publish state that follows this commit, then preserve the durability failure for the caller. */
export async function afterFileCommit(
  write: () => Promise<void>,
  publish: () => void | Promise<void>,
): Promise<void> {
  let warning: CommittedWriteError | undefined;
  try {
    await write();
  } catch (error) {
    if (!(error instanceof CommittedWriteError)) throw error;
    warning = error;
  }
  await publish();
  if (warning) throw warning;
}

/** Optional per-invocation verification observers; callers supply no observers ordinarily.
 * No environment flags, path selection, or fault policy belongs in this module.
 */
export interface AtomicWriteVerification {
  beforeWrite?(target: string, source: string | Uint8Array): Promise<void>;
  beforeCandidateSync?(target: string): Promise<void>;
  beforeParentSync?(
    target: string,
    directory: string,
    boundary: 'posix-directory-handle' | 'windows-directory-sync-unsupported',
  ): Promise<void>;
}

const writes = new Map<string, Promise<void>>();
export async function atomicWrite(
  filePath: string,
  content: string | Uint8Array,
  verification?: AtomicWriteVerification,
): Promise<void> {
  const key = path.resolve(filePath);
  const operation = (writes.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => writeFileAtomically(key, content, verification));
  writes.set(key, operation);
  try {
    await operation;
  } finally {
    if (writes.get(key) === operation) writes.delete(key);
  }
}

async function writeFileAtomically(
  filePath: string,
  content: string | Uint8Array,
  verification?: AtomicWriteVerification,
): Promise<void> {
  await assertNoLinks(filePath);
  await verification?.beforeWrite?.(filePath, content);
  const firstCreated = await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  try {
    // Flush the candidate before it replaces the destination. Without this a power loss
    // shortly after the rename can leave an empty or truncated file under the final name.
    const handle = await fs.open(temporary, 'wx');
    try {
      await handle.writeFile(content);
      await verification?.beforeCandidateSync?.(filePath);
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temporary, filePath);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
          process.platform !== 'win32' ||
          !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') ||
          attempt >= 5
        )
          throw error;
        // Windows readers can briefly deny replacement. Keep the old file intact.
        await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
        await assertNoLinks(filePath);
        await assertNoLinks(temporary);
      }
    }
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
  try {
    await syncDirectoryEntry(
      path.dirname(filePath),
      verification?.beforeParentSync
        ? (directory, boundary) => verification.beforeParentSync!(filePath, directory, boundary)
        : undefined,
    );
    // If mkdir created ancestors, also persist their names in each containing directory.
    if (firstCreated && process.platform !== 'win32') {
      let parent = path.dirname(filePath);
      while (parent !== path.dirname(firstCreated) && parent !== path.dirname(parent)) {
        parent = path.dirname(parent);
        await syncDirectoryEntry(parent);
      }
    }
  } catch (error) {
    throw new CommittedWriteError(filePath, error);
  }
}

/**
 * Persist the rename where Node supports directory fsync. On Windows only file bytes
 * are explicitly flushed; rename durability across power loss is not guaranteed.
 * Unsupported POSIX directory sync is best-effort. Permission and I/O errors propagate
 * even though replacement has already happened, so recovery must inspect live bytes.
 */
async function syncDirectoryEntry(
  directory: string,
  beforeSync?: (
    directory: string,
    boundary: 'posix-directory-handle' | 'windows-directory-sync-unsupported',
  ) => Promise<void> | undefined,
): Promise<void> {
  if (process.platform === 'win32') {
    await beforeSync?.(directory, 'windows-directory-sync-unsupported');
    return;
  }
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(directory, 'r');
  } catch (error) {
    if (['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
    throw error;
  }
  try {
    await beforeSync?.(directory, 'posix-directory-handle');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? ''))
      throw error;
  } finally {
    await handle.close();
  }
}
