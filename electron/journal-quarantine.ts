import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoLinks, isWithin } from './files.js';

export interface DamagedJournalReport {
  /** The journal token whose manifest could not be read. */
  token: string;
  /** Absolute path of the preserved journal directory. */
  quarantinedPath: string;
  /** Project-relative location of the preserved journal, with forward slashes. */
  relativePath: string;
}

export type DamagedJournalReporter = (report: DamagedJournalReport) => void | Promise<void>;

/**
 * Move a journal whose manifest is unreadable aside, inside its own journal root, so
 * project open and save can continue. The directory is renamed, never deleted: its
 * blobs stay available for manual recovery. The new name does not match any journal
 * token pattern, so discovery skips it from then on.
 */
export async function quarantineDamagedJournal(
  projectRoot: string,
  directory: string,
): Promise<DamagedJournalReport> {
  if (path.resolve(directory) === path.resolve(projectRoot) || !isWithin(projectRoot, directory))
    throw new Error('Journal quarantine must remain inside its project.');
  // Never follow or hide a linked/unsafe entry, including a manifest or backup blob.
  async function inspect(target: string): Promise<void> {
    await assertNoLinks(target);
    const entries = await fs.readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(target, entry.name);
      await assertNoLinks(child);
      if (entry.isDirectory()) await inspect(child);
      else if (!entry.isFile()) throw new Error('Unsafe journal entry; recovery files were preserved.');
    }
  }
  await inspect(directory);
  const token = path.basename(directory);
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const quarantinedPath = path.join(
    path.dirname(directory),
    `damaged-${token}-${stamp}-${randomUUID().slice(0, 8)}`,
  );
  await assertNoLinks(directory);
  await assertNoLinks(quarantinedPath);
  await fs.rename(directory, quarantinedPath);
  return {
    token,
    quarantinedPath,
    relativePath: path.relative(projectRoot, quarantinedPath).split(path.sep).join('/'),
  };
}
