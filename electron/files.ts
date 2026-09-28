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
    const stat = await handle.stat();
    const pathStat = await fs.lstat(target);
    if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino)
      throw new Error('A file path changed while it was opened.');
    if (!stat.isFile() || stat.size > maximumBytes)
      throw new FileReadLimitError('The file exceeds the read limit.');
    const buffer = new Uint8Array(stat.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const { bytesRead } = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
    }
    if (bytes > stat.size)
      throw new FileReadLimitError('The file grew beyond its read limit while it was read.');
    const finalPath = await fs.lstat(target);
    const finalHandle = await handle.stat();
    if (
      bytes !== stat.size ||
      finalPath.isSymbolicLink() ||
      stat.dev !== finalPath.dev ||
      stat.ino !== finalPath.ino ||
      stat.size !== finalHandle.size ||
      stat.mtimeMs !== finalHandle.mtimeMs ||
      stat.ctimeMs !== finalHandle.ctimeMs
    )
      throw new Error('A file changed while it was read.');
    return { text: utf8.decode(buffer.subarray(0, bytes)), bytes };
  } finally {
    await handle.close();
  }
}

const writes = new Map<string, Promise<void>>();
export async function atomicWrite(filePath: string, content: string | Uint8Array): Promise<void> {
  const key = path.resolve(filePath);
  const operation = (writes.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => writeFileAtomically(key, content));
  writes.set(key, operation);
  try {
    await operation;
  } finally {
    if (writes.get(key) === operation) writes.delete(key);
  }
}

async function writeFileAtomically(filePath: string, content: string | Uint8Array): Promise<void> {
  await assertNoLinks(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, content, { flag: 'wx' });
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
}
