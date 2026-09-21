import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isReservedProjectPath } from './content-search.js';
import { assertNoLinks, isWithin } from './files.js';

export const projectPathInput = z.string().min(1).max(2000);

/** Same sentinels the IPC project opener checks before treating a folder as a project. */
export const PROJECT_LINK_SENTINELS = [
  'project.json',
  'screenshots',
  'annotations',
  'notes',
  'exports',
  'rounds',
  'collections',
  '.imnota-undo',
  '.imnota-transactions',
  '.imnota-content-undo',
  '.imnota-recovery.json',
  '.imnota-recovery-backup.json',
] as const;

/** Authorize a project folder with the same containment rules as Electron IPC. */
export async function assertProjectPath(
  workspacePath: string | null | undefined,
  projectPath: string,
): Promise<string> {
  projectPathInput.parse(projectPath);
  if (!workspacePath) throw new Error('Choose a workspace folder before opening a project.');
  const resolved = path.resolve(projectPath);
  if (isReservedProjectPath(resolved))
    throw new Error(
      'Backup and recovery folders cannot be opened as active projects. Restore a snapshot first.',
    );
  await assertNoLinks(resolved);
  if (!isWithin(workspacePath, resolved) || resolved === path.resolve(workspacePath))
    throw new Error('Project path is outside the selected workspace.');
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('The selected project folder is unavailable.');
  for (const name of PROJECT_LINK_SENTINELS) await assertNoLinks(path.join(resolved, name));
  return resolved;
}
