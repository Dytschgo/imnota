import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoLinks } from './files.js';

/**
 * Top-level recovery state that belongs to the source project only. Each entry records the
 * source project's identity or an operation in flight there; the duplicate gets a new identity,
 * so copying any of them leaves it with recovery data it cannot resolve and may refuse to open.
 */
export const DUPLICATE_EXCLUDED_ENTRIES: ReadonlySet<string> = new Set([
  '.imnota-undo',
  '.imnota-content-undo',
  '.imnota-transactions',
  '.imnota-recovery.json',
  '.imnota-recovery-backup.json',
]);

/** Copies a project folder for Duplicate, leaving the source's recovery state behind. */
export async function copyProjectForDuplicate(source: string, target: string): Promise<void> {
  const root = path.resolve(source);
  await assertNoLinks(root);
  await assertNoLinks(target);
  await fs.cp(root, target, {
    recursive: true,
    // Only exact top-level names are skipped; everything else is copied as before.
    filter: async (entry) => {
      if (DUPLICATE_EXCLUDED_ENTRIES.has(path.relative(root, path.resolve(entry)).toLowerCase()))
        return false;
      await assertNoLinks(entry);
      return true;
    },
  });
}
