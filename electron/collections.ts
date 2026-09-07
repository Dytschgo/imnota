import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import type { ProjectData, ScreenshotRecord } from '../src/shared/types.js';
import { validateLegacyProject, validateProject, type LegacyProjectData } from '../src/shared/schema.js';
import { collectionName, DEFAULT_EXPORT_PREFERENCES } from '../src/shared/utils.js';
import { assertNoLinks, atomicWrite, isWithin } from './files.js';

export function screenshotPath(projectPath: string, shot: ScreenshotRecord): string {
  return path.join(projectPath, 'collections', shot.collectionId, 'screenshots', shot.storedFilename);
}

export async function ensureCollection(projectPath: string, collectionId: string): Promise<void> {
  for (const folder of ['screenshots', 'annotations', 'descriptions', 'exports']) {
    const target = path.join(projectPath, 'collections', collectionId, folder);
    await assertNoLinks(target);
    await fs.mkdir(target, { recursive: true });
  }
}

export function addEmptyCollection(
  project: ProjectData,
  workspaceName: string,
  id: string,
  timestamp: string,
): ProjectData {
  const number = project.collections.length + 1;
  return {
    ...project,
    updatedAt: timestamp,
    collections: [
      ...project.collections.map((collection) =>
        collection.archived ? collection : { ...collection, archived: true, updatedAt: timestamp },
      ),
      {
        id,
        name: collectionName(workspaceName, number),
        archived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        overallContext: '',
      },
    ],
  };
}

function legacyFile(projectPath: string, relative: string, expectedFolder: string): string {
  const normalized = relative.replaceAll('\\', '/');
  const parts = normalized.split('/');
  const validRoot = parts.length === 2 && parts[0] === expectedFolder;
  const validRound = parts.length === 4 && parts[0] === 'rounds' && parts[2] === expectedFolder;
  const target = path.resolve(projectPath, ...parts);
  if ((!validRoot && !validRound) || !isWithin(projectPath, target))
    throw new Error(`Legacy ${expectedFolder} path is outside the project.`);
  return target;
}

function legacyImagePath(projectPath: string, project: LegacyProjectData, index: number): string {
  const shot = project.screenshots[index];
  return project.schemaVersion === 1
    ? path.join(projectPath, 'screenshots', shot.storedFilename)
    : path.join(projectPath, 'rounds', shot.roundId, 'screenshots', shot.storedFilename);
}

export function mergeLegacyDescription(existing: string, legacyNotesMarkdown: string): string {
  const sections: string[] = [];
  if (existing.trim()) sections.push(existing);
  if (legacyNotesMarkdown.trim()) sections.push(`### Migrated legacy notes\n\n${legacyNotesMarkdown}`);
  return sections.join('\n\n');
}

function mergeOverallContext(project: LegacyProjectData): string {
  const preferences = project.exportPreferences;
  if (!preferences) return '';
  return [
    ['Desired outcome', preferences.desiredOutcome],
    ['Instructions for the AI agent', preferences.overallInstructions],
    ['Technical constraints', preferences.technicalConstraints],
  ]
    .filter((entry) => entry[1].trim())
    .map(([label, value]) => `### ${label}\n\n${value.trim()}`)
    .join('\n\n');
}

/**
 * Copy source content first and commit v3 metadata last. Legacy files and a
 * versioned project backup remain untouched for manual rollback.
 */
export async function migrateProject(
  projectPath: string,
  project: ProjectData | LegacyProjectData,
): Promise<ProjectData> {
  if (project.schemaVersion === 3) return project;

  project = validateLegacyProject(project);

  const collectionIds = new Set(project.rounds.map((round) => round.id));
  if (collectionIds.size !== project.rounds.length)
    throw new Error('Legacy project contains duplicate collection IDs.');
  if (new Set(project.screenshots.map((shot) => shot.id)).size !== project.screenshots.length)
    throw new Error('Legacy project contains duplicate screenshot IDs.');
  if (project.screenshots.some((shot) => !collectionIds.has(shot.roundId)))
    throw new Error('Legacy project contains a dangling collection reference.');

  const overallContext = mergeOverallContext(project);
  const collections = project.rounds.map((round) => ({
    id: round.id,
    name: round.name,
    archived: round.archived,
    createdAt: round.createdAt || project.createdAt,
    updatedAt: project.updatedAt,
    overallContext,
  }));
  const screenshots: ScreenshotRecord[] = [];

  const metadataPath = path.join(projectPath, 'project.json');
  const backup = path.join(projectPath, `project.v${project.schemaVersion}.backup.json`);
  await assertNoLinks(metadataPath);
  await assertNoLinks(backup);
  await fs.copyFile(metadataPath, backup, constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });

  for (const collection of collections) await ensureCollection(projectPath, collection.id);
  for (const [index, shot] of project.screenshots.entries()) {
    const annotationFile = `collections/${shot.roundId}/annotations/${shot.storedFilename}.json`;
    const descriptionFile = `collections/${shot.roundId}/descriptions/${shot.storedFilename}.md`;
    const migrated: ScreenshotRecord = {
      collectionId: shot.roundId,
      id: shot.id,
      originalFilename: shot.originalFilename,
      storedFilename: shot.storedFilename,
      title: shot.title || shot.originalFilename,
      description: '',
      position: shot.position,
      createdAt: shot.createdAt,
      updatedAt: shot.updatedAt,
      priority: shot.priority === 'critical' ? 'high' : shot.priority,
      annotationFile,
      descriptionFile,
      originalWidth: shot.originalWidth,
      originalHeight: shot.originalHeight,
      includeInExport: shot.includeInExport,
    };
    const notesPath = legacyFile(projectPath, shot.notesFile, 'notes');
    await assertNoLinks(notesPath);
    const notesMarkdown = await fs.readFile(notesPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    migrated.description = mergeLegacyDescription(shot.description, notesMarkdown);

    const sourceImage = legacyImagePath(projectPath, project, index);
    const sourceAnnotation = legacyFile(projectPath, shot.annotationFile, 'annotations');
    await assertNoLinks(sourceImage);
    await assertNoLinks(sourceAnnotation);
    await atomicWrite(screenshotPath(projectPath, migrated), await fs.readFile(sourceImage));
    await atomicWrite(
      path.join(projectPath, annotationFile),
      await fs.readFile(sourceAnnotation).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return Buffer.from('[]');
        throw error;
      }),
    );
    await atomicWrite(path.join(projectPath, descriptionFile), migrated.description);
    screenshots.push(migrated);
  }

  const next: ProjectData = {
    schemaVersion: 3,
    collections,
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    status: project.status,
    favourite: project.favourite,
    screenshots,
    exportPreferences: {
      ...DEFAULT_EXPORT_PREFERENCES,
      includeOriginalScreenshots:
        project.exportPreferences?.includeOriginalScreenshots ??
        DEFAULT_EXPORT_PREFERENCES.includeOriginalScreenshots,
      includeAnnotationMetadata:
        project.exportPreferences?.includeAnnotationMetadata ??
        DEFAULT_EXPORT_PREFERENCES.includeAnnotationMetadata,
    },
  };
  const validated = validateProject(next);
  await atomicWrite(metadataPath, JSON.stringify(validated, null, 2));
  return validated;
}
