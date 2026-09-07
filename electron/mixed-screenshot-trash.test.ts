// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScreenshotRecord } from '../src/shared/types.js';
import type { TextBlockRecord } from '../src/shared/content-items.js';
import { orderedCollectionItems } from '../src/shared/content-items.js';
import { emptyProject } from '../src/shared/utils.js';
import { deleteScreenshotToTrash, undoScreenshotDelete } from './screenshot-trash.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })));
});

describe('screenshot trash in a mixed collection', () => {
  it('normalizes shared positions on delete and restores the screenshot at its mixed position', async () => {
    const projectPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-mixed-trash-')));
    temporary.push(projectPath);
    const project = emptyProject('Mixed trash', '');
    project.schemaVersion = 4;
    const text: TextBlockRecord = {
      id: 'text_a',
      collectionId: '001-collection',
      kind: 'text',
      position: 0,
      includeInExport: true,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      markdownFilename: 'text_a.md',
    };
    const screenshot: ScreenshotRecord = {
      collectionId: '001-collection',
      id: 'shot_a',
      originalFilename: 'screen.png',
      storedFilename: 'screen.png',
      title: 'Screen',
      description: '',
      position: 1,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      priority: 'medium',
      annotationFile: 'collections/001-collection/annotations/screen.png.json',
      descriptionFile: 'collections/001-collection/descriptions/screen.png.md',
      originalWidth: 1,
      originalHeight: 1,
      includeInExport: true,
    };
    project.contentItems = [text];
    project.screenshots = [screenshot];
    await fs.mkdir(path.join(projectPath, 'collections/001-collection/screenshots'), { recursive: true });
    await fs.mkdir(path.join(projectPath, 'collections/001-collection/annotations'), { recursive: true });
    await fs.mkdir(path.join(projectPath, 'collections/001-collection/descriptions'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(project, null, 2));
    await fs.writeFile(path.join(projectPath, 'collections/001-collection/screenshots/screen.png'), 'png');
    await fs.writeFile(path.join(projectPath, screenshot.annotationFile), '[]');
    await fs.writeFile(path.join(projectPath, screenshot.descriptionFile), '');

    const deleted = await deleteScreenshotToTrash(projectPath, project, screenshot.id, (target) =>
      fs.unlink(target),
    );
    expect(orderedCollectionItems(deleted.project, '001-collection').map((item) => item.id)).toEqual([
      'text_a',
    ]);
    const restored = await undoScreenshotDelete(projectPath, deleted.project, deleted.undoToken);
    expect(orderedCollectionItems(restored.project, '001-collection').map((item) => item.id)).toEqual([
      'text_a',
      'shot_a',
    ]);
  });
});
