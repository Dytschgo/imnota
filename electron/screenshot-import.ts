import { nativeImage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from '../src/shared/utils.js';
import { ensureCollection } from './collections.js';
import { withCreatedFileCleanup } from './created-file-cleanup.js';
import type { IpcHost } from './main.js';

export async function importScreenshot(
  host: Pick<IpcHost, 'atomicWrite' | 'readProject' | 'uniqueStoredName' | 'nextScreenshotPosition'>,
  projectPath: string,
  sourcePath: string,
  originalFilename = path.basename(sourcePath),
  collectionId?: string,
): Promise<void> {
  const { atomicWrite, readProject, uniqueStoredName, nextScreenshotPosition } = host;
  const ext = path.extname(originalFilename).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext))
    throw new Error(`Unsupported screenshot format: ${originalFilename}. Use PNG, JPEG or WebP.`);
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error(`Imnota could not read ${originalFilename}. The file may be damaged.`);
  const project = await readProject(projectPath);
  const collection = project.collections.find(
    (item) => item.id === (collectionId ?? project.collections.find((candidate) => !candidate.archived)?.id),
  );
  if (!collection) throw new Error('Choose a collection before importing.');
  await ensureCollection(projectPath, collection.id);
  const storedFilename = await uniqueStoredName(projectPath, originalFilename);
  await withCreatedFileCleanup(path.join(projectPath, 'project.json'), async (create) => {
    const imagePath = path.join(projectPath, 'collections', collection.id, 'screenshots', storedFilename);
    const imageSource = await fs.readFile(sourcePath);
    await create(imagePath, (capture) => atomicWrite(imagePath, imageSource, capture));
    const timestamp = nowIso();
    project.screenshots.push({
      collectionId: collection.id,
      id: `shot_${crypto.randomUUID()}`,
      originalFilename,
      storedFilename,
      title: originalFilename,
      description: '',
      position: nextScreenshotPosition(project, collection.id),
      createdAt: timestamp,
      updatedAt: timestamp,
      priority: 'medium',
      annotationFile: `collections/${collection.id}/annotations/${storedFilename}.json`,
      descriptionFile: `collections/${collection.id}/descriptions/${storedFilename}.md`,
      originalWidth: image.getSize().width,
      originalHeight: image.getSize().height,
      includeInExport: true,
    });
    const added = project.screenshots.at(-1)!;
    const annotationPath = path.join(projectPath, added.annotationFile);
    const descriptionPath = path.join(projectPath, added.descriptionFile);
    await create(annotationPath, (capture) => atomicWrite(annotationPath, '[]', capture));
    await create(descriptionPath, (capture) => atomicWrite(descriptionPath, '', capture));
    project.updatedAt = timestamp;
    collection.archived = false;
    await atomicWrite(path.join(projectPath, 'project.json'), JSON.stringify(project, null, 2));
  });
}
