import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectData } from '../src/shared/types.js';
import { contentItemRelativePaths } from './content-paths.js';
import { assertNoLinks, isWithin } from './files.js';

/** Read-only existence check. Never recreate a missing source or remove its record. */
export async function inspectProjectFiles(
  projectPath: string,
  project: ProjectData,
  report: (target: string, error: unknown) => Promise<unknown>,
): Promise<string[]> {
  let unavailable = 0;
  const files = new Set(
    project.screenshots.flatMap((shot) => [
      `collections/${shot.collectionId}/screenshots/${shot.storedFilename}`,
      shot.annotationFile,
      shot.descriptionFile,
    ]),
  );
  for (const item of project.contentItems ?? [])
    for (const relative of Object.values(contentItemRelativePaths(item))) if (relative) files.add(relative);
  for (const relative of files) {
    const target = path.resolve(projectPath, relative);
    try {
      if (!isWithin(projectPath, target)) throw new Error('File is outside the project.');
      await assertNoLinks(target);
      const stat = await fs.stat(target);
      if (!stat.isFile()) throw new Error('Expected a regular file.');
    } catch (error) {
      unavailable++;
      await report(target, error);
    }
  }
  return unavailable
    ? [
        `${unavailable} project file${unavailable === 1 ? ' is' : 's are'} missing or inaccessible. Records have been kept. Preserve this project folder and check Backups & history and the system Recycle Bin/Trash. Settings > Workspace > Open diagnostics folder contains local investigation traces. Missing legacy sidecars can also produce this warning.`,
      ]
    : [];
}
