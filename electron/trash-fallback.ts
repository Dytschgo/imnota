import fs from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertNoLinks } from './files.js';
import { DELETED_ITEM_RETENTION_DAYS } from '../src/shared/recently-deleted.js';

export const LOCAL_TRASH_WARNING = `System trash did not confirm deletion. Recovery copies are kept in Imnota's Recently deleted for ${DELETED_ITEM_RETENTION_DAYS} days.`;

interface RecoveryBytes {
  size: number;
  sha256: string | null;
}

function unchanged(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    right.nlink === 1n &&
    right.isFile()
  );
}

/** Bounded, no-follow verification, including nonblocking refusal of a substituted FIFO. */
async function verifiedFile(target: string, expected: RecoveryBytes): Promise<BigIntStats | null> {
  await assertNoLinks(target);
  const flags =
    constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const handle = await fs.open(target, flags).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!handle) return null;
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(expected.size))
      throw new Error('The file is not a single regular recovery file of the expected size.');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, expected.size - size + 1),
        size,
      );
      if (!bytesRead) break;
      size += bytesRead;
      if (size > expected.size) throw new Error('The file grew during recovery verification.');
      hash.update(buffer.subarray(0, bytesRead));
    }
    await assertNoLinks(target);
    const after = await handle.stat({ bigint: true });
    const current = await fs.lstat(target, { bigint: true });
    if (
      size !== expected.size ||
      hash.digest('hex') !== expected.sha256 ||
      !unchanged(before, after) ||
      !unchanged(before, current)
    )
      throw new Error('The file changed during recovery verification.');
    return current;
  } finally {
    await handle.close();
  }
}

/** The caller's durable journal owns recovery and rollback; this adds no new storage format. */
export async function trashWithLocalRecovery(
  target: string,
  backupPath: string,
  expected: RecoveryBytes,
  trashItem: (target: string) => Promise<void>,
  unlink: (target: string) => Promise<void>,
): Promise<boolean> {
  if (
    !Number.isSafeInteger(expected.size) ||
    expected.size < 0 ||
    !expected.sha256 ||
    !/^[a-f0-9]{64}$/.test(expected.sha256)
  )
    throw new Error('Local recovery requires a complete backup descriptor.');
  const before = await fs.lstat(target, { bigint: true });
  try {
    await trashItem(target);
    return false;
  } catch (trashError) {
    try {
      const backup = await verifiedFile(backupPath, expected);
      if (!backup) throw new Error('The local recovery copy is missing.');
      const current = await verifiedFile(target, expected);
      // The OS can remove a file and still reject; the verified local copy remains restorable.
      if (!current) return true;
      if (!unchanged(before, current)) throw new Error('The source changed while system trash was running.');
      await assertNoLinks(target);
      await assertNoLinks(backupPath);
      const [lastSource, lastBackup] = await Promise.all([
        fs.lstat(target, { bigint: true }),
        fs.lstat(backupPath, { bigint: true }),
      ]);
      if (!unchanged(current, lastSource) || !unchanged(backup, lastBackup))
        throw new Error('The source or recovery copy changed before removal.');
      // Node has no conditional unlink; another process can still change a path after these checks.
      await unlink(target);
      return true;
    } catch (fallbackError) {
      throw new Error(
        `System trash failed and local recovery could not complete: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        { cause: trashError },
      );
    }
  }
}
