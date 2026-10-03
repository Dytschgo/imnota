import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks } from './files.js';

/**
 * Called only after a committed, expired journal passes restore/integrity validation.
 * The rename is the irreversible retention boundary: Undo discovery never sees an
 * expiring journal with partly removed blobs. If cleanup fails, keep the remainder
 * under expired-* for manual inspection; do not retry unvalidated recursive deletion.
 */
export async function retireDeleteJournal(
  directory: string,
  remove: (target: string) => Promise<void>,
  assertCurrent: () => Promise<void>,
): Promise<void> {
  await assertNoLinks(directory);
  const expired = path.join(path.dirname(directory), `expired-${path.basename(directory)}-${randomUUID()}`);
  await assertNoLinks(expired);
  await assertCurrent();
  await fs.rename(directory, expired);
  try {
    await remove(expired);
  } catch (cause) {
    throw new Error(
      `The retention period ended, but cleanup is incomplete at ${expired}. Remaining files were kept for manual inspection.`,
      { cause },
    );
  }
}
