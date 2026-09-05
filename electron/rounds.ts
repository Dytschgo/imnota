import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import type { ProjectData, ScreenshotRecord } from '../src/shared/types.js';
import { assertNoLinks, atomicWrite } from './files.js';

export function screenshotPath(projectPath: string, shot: ScreenshotRecord): string {
  return path.join(projectPath, 'rounds', shot.roundId, 'screenshots', shot.storedFilename);
}

export async function ensureRound(projectPath: string, roundId: string): Promise<void> {
  for (const folder of ['screenshots', 'annotations', 'notes', 'exports']) {
    const target = path.join(projectPath, 'rounds', roundId, folder);
    await assertNoLinks(target);
    await fs.mkdir(target, { recursive: true });
  }
}

/** Copy first, commit metadata last. The untouched v1 files remain a rollback copy. */
export async function migrateRounds(projectPath: string, project: ProjectData): Promise<ProjectData> {
  if (project.schemaVersion === 2) return project;
  const next: ProjectData = {
    ...project,
    schemaVersion: 2,
    screenshots: project.screenshots.map((shot) => ({
      ...shot,
      annotationFile: `rounds/${shot.roundId}/annotations/${shot.storedFilename}.json`,
      notesFile: `rounds/${shot.roundId}/notes/${shot.storedFilename}.md`,
    })),
  };
  const backup = path.join(projectPath, 'project.v1.backup.json');
  await assertNoLinks(backup);
  await fs
    .copyFile(path.join(projectPath, 'project.json'), backup, constants.COPYFILE_EXCL)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  for (const round of next.rounds) await ensureRound(projectPath, round.id);
  for (const [index, shot] of project.screenshots.entries()) {
    const dest = next.screenshots[index];
    for (const [source, target, optional] of [
      [path.join(projectPath, 'screenshots', shot.storedFilename), screenshotPath(projectPath, dest), false],
      [path.join(projectPath, shot.annotationFile), path.join(projectPath, dest.annotationFile), true],
      [path.join(projectPath, shot.notesFile), path.join(projectPath, dest.notesFile), true],
    ] as const) {
      await assertNoLinks(source);
      try {
        await atomicWrite(target, await fs.readFile(source));
      } catch (error) {
        if (!optional || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  await atomicWrite(path.join(projectPath, 'project.json'), JSON.stringify(next, null, 2));
  return next;
}
