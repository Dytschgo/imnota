// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyProject } from '../src/shared/utils.js';
import { inspectProjectFiles } from './project-integrity.js';
import type { ProjectData } from '../src/shared/types.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('reports missing screenshot sidecars and mixed content without recreating files or dropping records', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-integrity-')));
  roots.push(root);
  const project: ProjectData = {
    ...emptyProject('Preserve', ''),
    schemaVersion: 4,
    screenshots: [
      {
        id: 'shot_a',
        collectionId: '001-collection',
        originalFilename: 'original.png',
        storedFilename: 'original.png',
        title: 'Evidence',
        description: '',
        position: 0,
        createdAt: '2026-09-22T00:00:00Z',
        updatedAt: '2026-09-22T00:00:00Z',
        priority: 'medium',
        annotationFile: 'collections/001-collection/annotations/original.png.json',
        descriptionFile: 'collections/001-collection/descriptions/original.png.md',
        originalWidth: 1,
        originalHeight: 1,
        includeInExport: true,
      },
    ],
    contentItems: [
      {
        id: 'text_a',
        collectionId: '001-collection',
        kind: 'text',
        markdownFilename: 'text_a.md',
        position: 1,
        includeInExport: true,
        createdAt: '2026-09-22T00:00:00Z',
        updatedAt: '2026-09-22T00:00:00Z',
      },
    ],
  };
  const source = JSON.stringify(project);
  await fs.writeFile(path.join(root, 'project.json'), source);
  const report = vi.fn<(target: string, error: unknown) => Promise<void>>(async () => undefined);
  const warnings = await inspectProjectFiles(root, project, report);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('4 project files are missing or inaccessible');
  expect(report).toHaveBeenCalledTimes(4);
  expect(await fs.readdir(root)).toEqual(['project.json']);
  expect(await fs.readFile(path.join(root, 'project.json'), 'utf8')).toBe(source);
  expect(JSON.stringify(project)).toBe(source);

  for (const [target] of report.mock.calls) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'synthetic bytes');
  }
  report.mockClear();
  expect(await inspectProjectFiles(root, project, report)).toEqual([]);
  expect(report).not.toHaveBeenCalled();
});
