import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoLinks, isWithin } from './files.js';
import { validateProject } from '../src/shared/schema.js';
import type { ProjectData } from '../src/shared/types.js';

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

/** Exclusively creates a folder and publishes NEW metadata last. Failed copying
 * cannot expose the source project identity, even if cleanup is unavailable.
 */
export async function copyProjectForDuplicate(
  source: string,
  target: string,
  copy: ProjectData,
): Promise<void> {
  const root = path.resolve(source);
  const destination = path.resolve(target);
  if (isWithin(root, destination)) throw new Error('A duplicate must be outside its source project.');
  await assertNoLinks(root);
  await assertNoLinks(destination);
  const metadata = JSON.stringify(validateProject(copy), null, 2);
  await assertNoLinks(path.join(root, 'project.json'));
  const original = validateProject(JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8')));
  if (copy.id === original.id) throw new Error('A duplicate must have a new project identity.');
  await fs.mkdir(destination, { recursive: false });
  const owned = await fs.lstat(destination, { bigint: true });
  const assertOwned = async () => {
    await assertNoLinks(destination);
    const current = await fs.lstat(destination, { bigint: true });
    if (!current.isDirectory() || current.dev !== owned.dev || current.ino !== owned.ino)
      throw new Error('Duplicate destination changed; it was preserved for manual inspection.');
  };
  try {
    for (const name of await fs.readdir(root)) {
      await fs.cp(path.join(root, name), path.join(destination, name), {
        recursive: true,
        force: false,
        errorOnExist: true,
        filter: async (entry) => {
          const relative = path.relative(root, path.resolve(entry)).toLowerCase();
          if (relative === 'project.json' || DUPLICATE_EXCLUDED_ENTRIES.has(relative)) return false;
          await assertOwned();
          await assertNoLinks(entry);
          await assertNoLinks(path.join(destination, path.relative(root, entry)));
          return true;
        },
      });
    }
    await assertOwned();
    await fs.writeFile(path.join(destination, 'project.json'), metadata, { flag: 'wx' });
  } catch (cause) {
    try {
      // Never recursively delete a supplied path. Check call ownership and each
      // directory identity; refuse links/replacements and retain uncertain remnants.
      const removeOwned = async (directory: string): Promise<void> => {
        await assertOwned();
        await assertNoLinks(directory);
        const identity = await fs.lstat(directory, { bigint: true });
        const assertDirectory = async () => {
          await assertOwned();
          await assertNoLinks(directory);
          const current = await fs.lstat(directory, { bigint: true });
          if (identity.dev !== current.dev || identity.ino !== current.ino)
            throw new Error('Duplicate cleanup path changed.');
        };
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          await assertNoLinks(path.join(directory, entry.name));
          if (!entry.isFile() && !entry.isDirectory()) throw new Error('Unexpected duplicate cleanup entry.');
        }
        for (const entry of entries) {
          await assertDirectory();
          const child = path.join(directory, entry.name);
          await assertNoLinks(child);
          if (entry.isDirectory()) await removeOwned(child);
          else await fs.unlink(child);
        }
        await assertDirectory();
        await fs.rmdir(directory);
      };
      await removeOwned(destination);
    } catch (cleanup) {
      throw new Error(
        `Duplicate failed; incomplete files were retained at ${destination} for manual inspection: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`,
        { cause },
      );
    }
    throw cause;
  }
}
