import fs from 'node:fs/promises';
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
    await fs.rename(temporary, filePath);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}
